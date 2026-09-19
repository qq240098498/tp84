// 责任人相关动作：按责任人汇总、批量转交的预演与执行、转交留痕
// 一条转交记录对应一条依赖登记；同一次批量执行共用一个 batchId 与同一个时间，
// 页面上按批次合并展示，展开后看得到每条登记原来在谁名下
const crypto = require('crypto');
const { load, save, MAX_OWNER_LENGTH } = require('./store');
const { ApiError, pickText } = require('./errors');

const MAX_BATCH_SIZE = 300;

function validateOwner(value) {
  const owner = pickText(value);
  if (owner.length > MAX_OWNER_LENGTH) {
    throw new ApiError(400, 'OWNER_TOO_LONG', `责任人名字不能超过 ${MAX_OWNER_LENGTH} 个字符`, 'toOwner');
  }
  return owner;
}

// 操作者是留痕里“由谁转交”的来源，批量执行时必须填
function validateOperator(value) {
  const operator = pickText(value);
  if (!operator) throw new ApiError(400, 'OPERATOR_REQUIRED', '请先在顶栏填写当前操作者，转交要留下是谁办的', 'operator');
  if (operator.length > MAX_OWNER_LENGTH) {
    throw new ApiError(400, 'OPERATOR_TOO_LONG', `操作者名字不能超过 ${MAX_OWNER_LENGTH} 个字符`, 'operator');
  }
  return operator;
}

function validateReason(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new ApiError(400, 'REASON_INVALID', '备注需要是文本', 'reason');
  const reason = value.trim();
  if (reason.length > 200) throw new ApiError(400, 'REASON_TOO_LONG', '备注不能超过 200 个字符', 'reason');
  return reason;
}

// 勾选出来的登记编号：去重、去空、限量，一条都没选不算一次转交
function parseDepIds(value) {
  if (!Array.isArray(value)) {
    throw new ApiError(400, 'DEP_IDS_INVALID', '请勾选要转交的依赖登记', 'depIds');
  }
  const ids = [];
  const seen = new Set();
  value.forEach((item) => {
    if (typeof item !== 'string') return;
    const id = item.trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  });
  if (!ids.length) throw new ApiError(400, 'TRANSFER_EMPTY', '请先勾选要转交的依赖登记', 'depIds');
  if (ids.length > MAX_BATCH_SIZE) {
    throw new ApiError(400, 'TRANSFER_TOO_MANY', `一次最多转交 ${MAX_BATCH_SIZE} 条，请分批处理`, 'depIds');
  }
  return ids;
}

// 未指定（责任人为空）排在最后，其余按名字排，顺序固定页面才对得上
function compareOwner(a, b) {
  if (a === b) return 0;
  if (a === '') return 1;
  if (b === '') return -1;
  return a < b ? -1 : 1;
}

function countByOwner(deps) {
  const map = new Map();
  deps.forEach((item) => {
    const key = item.owner || '';
    map.set(key, (map.get(key) || 0) + 1);
  });
  return map;
}

function ownerGroupList(deps) {
  return Array.from(countByOwner(deps).entries())
    .map(([owner, count]) => ({ owner, count }))
    .sort((a, b) => compareOwner(a.owner, b.owner));
}

// 按责任人汇总：每个人（含未指定）名下多少条、具体是哪些项目的哪些依赖
function listOwners() {
  const data = load();
  const projectNames = new Map(data.projects.map((item) => [item.id, item.name]));
  const groupsMap = new Map();
  data.deps.forEach((dep) => {
    const key = dep.owner || '';
    if (!groupsMap.has(key)) groupsMap.set(key, []);
    groupsMap.get(key).push({
      id: dep.id,
      projectId: dep.projectId,
      projectName: projectNames.get(dep.projectId) || dep.projectId,
      name: dep.name,
      version: dep.version,
      license: dep.license,
      status: dep.status,
      owner: dep.owner,
      note: dep.note,
      updatedAt: dep.updatedAt,
    });
  });

  const groups = Array.from(groupsMap.entries())
    .map(([owner, items]) => ({
      owner,
      count: items.length,
      items: items.sort((a, b) => {
        if (a.projectName !== b.projectName) return a.projectName < b.projectName ? -1 : 1;
        if (a.name !== b.name) return a.name < b.name ? -1 : 1;
        return a.id < b.id ? -1 : 1;
      }),
    }))
    .sort((a, b) => compareOwner(a.owner, b.owner));

  return { groups, total: data.deps.length };
}

// 预演的核心：找出要改的登记与已经在新责任人名下的登记，
// 并把转交前后每个责任人的条数都算出来，两边必须对得上
function buildPlan(data, depIds, toOwner) {
  const projectNames = new Map(data.projects.map((item) => [item.id, item.name]));
  const found = [];
  const missingIds = [];
  depIds.forEach((id) => {
    const dep = data.deps.find((item) => item.id === id);
    if (dep) found.push(dep);
    else missingIds.push(id);
  });

  const items = found.map((dep) => {
    const fromOwner = dep.owner || '';
    return {
      id: dep.id,
      projectId: dep.projectId,
      projectName: projectNames.get(dep.projectId) || dep.projectId,
      name: dep.name,
      version: dep.version,
      fromOwner,
      toOwner,
      willChange: fromOwner !== toOwner,
    };
  });
  const changeItems = items.filter((item) => item.willChange);

  const beforeMap = countByOwner(data.deps);
  const afterMap = new Map(beforeMap);
  changeItems.forEach((item) => {
    const from = item.fromOwner || '';
    const to = item.toOwner || '';
    if (from !== to) {
      afterMap.set(from, (afterMap.get(from) || 0) - 1);
      afterMap.set(to, (afterMap.get(to) || 0) + 1);
    }
  });

  const toGroupList = (map) => Array.from(map.entries())
    .filter(([, count]) => count > 0)
    .map(([owner, count]) => ({ owner, count }))
    .sort((a, b) => compareOwner(a.owner, b.owner));

  const affectedKeys = new Set();
  changeItems.forEach((item) => {
    affectedKeys.add(item.fromOwner || '');
    affectedKeys.add(item.toOwner || '');
  });
  const affected = Array.from(affectedKeys)
    .sort(compareOwner)
    .map((owner) => ({
      owner,
      before: beforeMap.get(owner) || 0,
      after: afterMap.get(owner) || 0,
      delta: (afterMap.get(owner) || 0) - (beforeMap.get(owner) || 0),
    }));

  return {
    toOwner,
    requestedCount: depIds.length,
    foundCount: found.length,
    missingCount: missingIds.length,
    missingIds,
    changeCount: changeItems.length,
    skipCount: items.length - changeItems.length,
    items,
    counts: { before: toGroupList(beforeMap), after: toGroupList(afterMap), affected },
  };
}

function previewTransfer(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const depIds = parseDepIds(input.depIds);
  const toOwner = validateOwner(input.toOwner);
  return buildPlan(load(), depIds, toOwner);
}

// 把一次转交落成留痕：同批共用 batchId 与时间，一条登记一条记录
function appendTransferRecords(data, entries, operator, reason) {
  if (!Array.isArray(data.transfers)) data.transfers = [];
  const batchId = crypto.randomUUID();
  const at = new Date().toISOString();
  const projectNames = new Map(data.projects.map((item) => [item.id, item.name]));
  const records = entries.map((entry) => ({
    id: crypto.randomUUID(),
    batchId,
    depId: entry.dep.id,
    fromOwner: entry.fromOwner || '',
    toOwner: entry.toOwner || '',
    operator,
    at,
    reason,
    depSnapshot: {
      id: entry.dep.id,
      projectId: entry.dep.projectId,
      projectName: projectNames.get(entry.dep.projectId) || entry.dep.projectId,
      name: entry.dep.name,
      version: entry.dep.version,
    },
  }));
  data.transfers.push(...records);
  return { batchId, at, records };
}

function executeTransfer(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const operator = validateOperator(input.operator);
  const reason = validateReason(input.reason);
  const depIds = parseDepIds(input.depIds);
  const toOwner = validateOwner(input.toOwner);

  const data = load();
  const plan = buildPlan(data, depIds, toOwner);
  if (plan.missingCount) {
    throw new ApiError(
      409,
      'TRANSFER_DEPS_MISSING',
      `勾选的登记里有 ${plan.missingCount} 条已经不存在（例如 ${plan.missingIds.slice(0, 3).join('、')}），请刷新后重新勾选`,
      'depIds',
    );
  }
  if (!plan.changeCount) {
    throw new ApiError(400, 'TRANSFER_NO_CHANGE', '所选登记都已经在这个责任人名下，没有需要改动的登记', 'toOwner');
  }

  // 只动真正需要改的登记；已经挂在新责任人名下的不写记录、不改更新时间
  const changeMap = new Map(plan.items.filter((item) => item.willChange).map((item) => [item.id, item]));
  const entries = [];
  const now = new Date().toISOString();
  data.deps.forEach((dep) => {
    const planned = changeMap.get(dep.id);
    if (!planned) return;
    entries.push({ dep, fromOwner: dep.owner || '', toOwner });
    dep.owner = toOwner;
    dep.updatedAt = now;
  });

  const { batchId, at, records } = appendTransferRecords(data, entries, operator, reason || '批量转交');
  save(data);

  return {
    batchId,
    at,
    operator,
    toOwner,
    changeCount: entries.length,
    skipCount: plan.skipCount,
    changes: records.map((record) => ({
      id: record.id,
      depId: record.depId,
      projectName: record.depSnapshot.projectName,
      name: record.depSnapshot.name,
      version: record.depSnapshot.version,
      fromOwner: record.fromOwner,
      toOwner: record.toOwner,
    })),
    counts: plan.counts,
  };
}

// 单条编辑里改了责任人也要留痕，返回批次信息供调用方一并落盘
function recordSingleOwnerChange(data, dep, fromOwner, toOwner, operator) {
  return appendTransferRecords(
    data,
    [{ dep, fromOwner: fromOwner || '', toOwner: toOwner || '' }],
    operator,
    '编辑登记时修改责任人',
  );
}

// 转交记录按批次倒序：最新一次在最前面，同批的登记挂在一起
function listTransfers(options) {
  const input = options && typeof options === 'object' ? options : {};
  let limit = Number.parseInt(input.limit, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 50;
  if (limit > 200) limit = 200;

  const data = load();
  // 从后往前先找出最近的 limit 个批次，再回头把这些批次的记录收全，
  // 不能只截最后一段记录，否则大批次会被截断
  const batchIds = new Set();
  for (let i = data.transfers.length - 1; i >= 0 && batchIds.size < limit; i -= 1) {
    batchIds.add(data.transfers[i].batchId);
  }
  const batchesMap = new Map();
  for (let i = data.transfers.length - 1; i >= 0; i -= 1) {
    const record = data.transfers[i];
    if (!batchIds.has(record.batchId)) continue;
    if (!batchesMap.has(record.batchId)) {
      batchesMap.set(record.batchId, {
        batchId: record.batchId,
        at: record.at,
        operator: record.operator,
        toOwner: record.toOwner,
        reason: record.reason,
        records: [],
      });
    }
    batchesMap.get(record.batchId).records.push(record);
  }

  const batches = Array.from(batchesMap.values());
  batches.forEach((batch) => {
    batch.records.sort((a, b) => {
      const an = a.depSnapshot.projectName;
      const bn = b.depSnapshot.projectName;
      if (an !== bn) return an < bn ? -1 : 1;
      return a.depSnapshot.name < b.depSnapshot.name ? -1 : 1;
    });
    batch.count = batch.records.length;
    // 同一批里可能来自好几个原责任人，摘要里各算各的条数
    batch.fromGroups = Array.from(
      batch.records.reduce((map, record) => {
        const key = record.fromOwner || '';
        map.set(key, (map.get(key) || 0) + 1);
        return map;
      }, new Map()).entries(),
    )
      .map(([owner, count]) => ({ owner, count }))
      .sort((a, b) => compareOwner(a.owner, b.owner));
  });

  return { batches, totalRecords: data.transfers.length };
}

module.exports = {
  listOwners,
  previewTransfer,
  executeTransfer,
  recordSingleOwnerChange,
  listTransfers,
};
