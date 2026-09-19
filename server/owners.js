// 责任人视角：按人统计名下的依赖条数、批量转交（先预演再执行）、转交留痕
const crypto = require('crypto');
const { load, save, MAX_OWNER_LENGTH } = require('./store');
const { ApiError, pickText } = require('./errors');

// 一次批量转交最多处理的条数，避免误把整张表一次性改掉
const MAX_TRANSFER_BATCH = 500;

function validateToOwner(value) {
  const owner = pickText(value);
  if (owner.length > MAX_OWNER_LENGTH) {
    throw new ApiError(400, 'OWNER_TOO_LONG', `责任人名字不能超过 ${MAX_OWNER_LENGTH} 个字符`, 'toOwner');
  }
  return owner;
}

function validateOperator(value) {
  const operator = pickText(value);
  if (operator.length > MAX_OWNER_LENGTH) {
    throw new ApiError(400, 'OPERATOR_TOO_LONG', `操作者名字不能超过 ${MAX_OWNER_LENGTH} 个字符`, 'operator');
  }
  return operator;
}

// 选定的一批登记：去重、逐条确认存在，缺任何一条都不往下走
function pickDeps(data, depIds) {
  if (!Array.isArray(depIds) || !depIds.length) {
    throw new ApiError(400, 'TRANSFER_EMPTY', '请先选定要转交的登记', 'depIds');
  }
  const ids = Array.from(new Set(depIds.map((id) => pickText(id)).filter(Boolean)));
  if (!ids.length) throw new ApiError(400, 'TRANSFER_EMPTY', '请先选定要转交的登记', 'depIds');
  if (ids.length > MAX_TRANSFER_BATCH) {
    throw new ApiError(400, 'TRANSFER_TOO_MANY', `一次最多转交 ${MAX_TRANSFER_BATCH} 条登记`, 'depIds');
  }
  return ids.map((id) => {
    const found = data.deps.find((item) => item.id === id);
    if (!found) throw new ApiError(404, 'DEP_NOT_FOUND', `登记 ${id} 不存在或已被删除，请刷新后重新选定`, 'depIds');
    return found;
  });
}

function projectNameOf(data, projectId) {
  const found = data.projects.find((item) => item.id === projectId);
  return found ? found.name : '';
}

function sortEntries(list) {
  return list.sort((a, b) => {
    if (a.projectName !== b.projectName) return a.projectName < b.projectName ? -1 : 1;
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
}

function toEntry(data, dep) {
  return {
    id: dep.id,
    projectId: dep.projectId,
    projectName: projectNameOf(data, dep.projectId),
    name: dep.name,
    version: dep.version,
    license: dep.license,
    status: dep.status,
    updatedAt: dep.updatedAt,
  };
}

// 按责任人把登记分组：每个人名下一组，没写责任人的单独归一组，不混在任何一个人下面
function listOwners() {
  const data = load();
  const byOwner = new Map();
  const unassigned = [];
  data.deps.forEach((dep) => {
    const entry = toEntry(data, dep);
    if (!dep.owner) {
      unassigned.push(entry);
      return;
    }
    if (!byOwner.has(dep.owner)) byOwner.set(dep.owner, []);
    byOwner.get(dep.owner).push(entry);
  });

  const owners = Array.from(byOwner.entries())
    .map(([owner, deps]) => ({ owner, count: deps.length, deps: sortEntries(deps) }))
    .sort((a, b) => (b.count - a.count) || a.owner.localeCompare(b.owner, 'zh'));

  return {
    owners,
    unassigned: { count: unassigned.length, deps: sortEntries(unassigned) },
    total: data.deps.length,
  };
}

// 把一批登记改到同一个新责任人名下：toOwner 为空表示撤掉责任人，回到未指定那一组
function planTransfer(data, depIds, toOwner) {
  const targets = pickDeps(data, depIds);
  const changes = [];
  const unchanged = [];
  targets.forEach((dep) => {
    const change = {
      id: dep.id,
      projectId: dep.projectId,
      projectName: projectNameOf(data, dep.projectId),
      name: dep.name,
      fromOwner: dep.owner,
      toOwner,
    };
    if (dep.owner === toOwner) unchanged.push(change);
    else changes.push(change);
  });
  return { targets, changes, unchanged };
}

// 转交前后每个相关责任人的条数对照，owner 为空串表示未指定那一组
function countDelta(data, changes) {
  const before = new Map();
  data.deps.forEach((dep) => before.set(dep.owner, (before.get(dep.owner) || 0) + 1));

  const after = new Map(before);
  const touched = new Set();
  changes.forEach((change) => {
    touched.add(change.fromOwner);
    touched.add(change.toOwner);
    after.set(change.fromOwner, (after.get(change.fromOwner) || 0) - 1);
    after.set(change.toOwner, (after.get(change.toOwner) || 0) + 1);
  });

  return Array.from(touched)
    .map((owner) => ({ owner, before: before.get(owner) || 0, after: after.get(owner) || 0 }))
    .sort((a, b) => {
      if (!a.owner) return 1;
      if (!b.owner) return -1;
      return a.owner.localeCompare(b.owner, 'zh');
    });
}

// 预演：只算不改，返回会改动哪些登记、哪些本来就在新责任人名下、前后条数对照
function previewTransfer(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const toOwner = validateToOwner(input.toOwner);
  const data = load();
  const { changes, unchanged } = planTransfer(data, input.depIds, toOwner);
  return { toOwner, changes, unchanged, counts: countDelta(data, changes) };
}

// 执行：改动落盘并留下一条转交记录，返回记录与前后条数对照
function executeTransfer(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const toOwner = validateToOwner(input.toOwner);
  const operator = validateOperator(input.operator);
  const data = load();
  const { targets, changes } = planTransfer(data, input.depIds, toOwner);
  if (!changes.length) {
    throw new ApiError(409, 'TRANSFER_NO_CHANGE', toOwner
      ? `选中的登记本来就在 ${toOwner} 名下，没有需要改动的`
      : '选中的登记本来就没有责任人，没有需要改动的', 'toOwner');
  }

  // 条数对照要在改动之前算，before 才是转交前的真实条数
  const counts = countDelta(data, changes);
  const now = new Date().toISOString();
  const changedIds = new Set(changes.map((change) => change.id));
  targets.forEach((dep) => {
    if (!changedIds.has(dep.id)) return;
    dep.owner = toOwner;
    dep.updatedAt = now;
  });

  const record = {
    id: crypto.randomUUID(),
    at: now,
    operator,
    toOwner,
    items: changes.map((change) => ({
      depId: change.id,
      projectId: change.projectId,
      projectName: change.projectName,
      name: change.name,
      fromOwner: change.fromOwner,
    })),
  };
  data.transfers.push(record);
  save(data);
  return { transfer: record, counts };
}

// 转交记录：新的在前，每一条都能看到什么时候由谁把哪些登记转给了谁
function listTransfers() {
  const data = load();
  const transfers = data.transfers.slice().sort((a, b) => (a.at < b.at ? 1 : -1));
  return { transfers };
}

module.exports = {
  listOwners,
  previewTransfer,
  executeTransfer,
  listTransfers,
};
