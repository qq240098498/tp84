const crypto = require('crypto');
const { load, save, STATUSES, MAX_NAME_LENGTH, MAX_VERSION_LENGTH, MAX_LICENSE_LENGTH, MAX_OWNER_LENGTH, MAX_NOTE_LENGTH } = require('./store');
const { ApiError, pickText } = require('./errors');
const { findProject } = require('./projects');
const transfers = require('./transfers');

// 依赖名允许小写字母、数字、点、下划线、短横线，也允许带范围的写法
const NAME_PATTERN = /^[@a-z0-9][@a-z0-9._/-]*$/;
// 版本写法固定成三段数字，后面可选择带一段预发布后缀
const VERSION_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;

function validateName(value) {
  const name = pickText(value);
  if (!name) throw new ApiError(400, 'DEP_NAME_REQUIRED', '请填写依赖名称', 'depName');
  if (name.length > MAX_NAME_LENGTH) {
    throw new ApiError(400, 'DEP_NAME_TOO_LONG', `依赖名称不能超过 ${MAX_NAME_LENGTH} 个字符`, 'depName');
  }
  if (!NAME_PATTERN.test(name)) {
    throw new ApiError(400, 'DEP_NAME_INVALID', '依赖名称只能用小写字母、数字、点、下划线、短横线与斜线，并且要以字母或数字开头', 'depName');
  }
  return name;
}

function validateVersion(value) {
  const version = pickText(value);
  if (!version) throw new ApiError(400, 'VERSION_REQUIRED', '请填写版本', 'version');
  if (version.length > MAX_VERSION_LENGTH) {
    throw new ApiError(400, 'VERSION_TOO_LONG', `版本不能超过 ${MAX_VERSION_LENGTH} 个字符`, 'version');
  }
  if (!VERSION_PATTERN.test(version)) {
    throw new ApiError(400, 'VERSION_INVALID', '版本要写成三段数字，例如 2.7.18，需要时可以带一段预发布后缀', 'version');
  }
  return version;
}

function validateLicense(value) {
  const license = pickText(value);
  if (license.length > MAX_LICENSE_LENGTH) {
    throw new ApiError(400, 'LICENSE_TOO_LONG', `许可名称不能超过 ${MAX_LICENSE_LENGTH} 个字符`, 'license');
  }
  return license;
}

function validateOwner(value) {
  const owner = pickText(value);
  if (owner.length > MAX_OWNER_LENGTH) {
    throw new ApiError(400, 'OWNER_TOO_LONG', `责任人名字不能超过 ${MAX_OWNER_LENGTH} 个字符`, 'owner');
  }
  return owner;
}

function validateStatus(value) {
  const status = pickText(value);
  if (!status) return STATUSES[0];
  if (!STATUSES.includes(status)) {
    throw new ApiError(400, 'STATUS_INVALID', `状态只能是 ${STATUSES.join('、')} 其中之一`, 'status');
  }
  return status;
}

function validateNote(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new ApiError(400, 'NOTE_INVALID', '备注需要是文本', 'note');
  if (value.length > MAX_NOTE_LENGTH) {
    throw new ApiError(400, 'NOTE_TOO_LONG', `备注不能超过 ${MAX_NOTE_LENGTH} 个字符`, 'note');
  }
  return value.trim();
}

// 同一个项目下不允许出现同名依赖，比较时忽略大小写
function assertNameFree(data, projectId, name, selfId) {
  const hit = data.deps.find((item) => item.projectId === projectId
    && item.id !== selfId
    && item.name.toLowerCase() === name.toLowerCase());
  if (hit) throw new ApiError(409, 'DEP_DUPLICATED', `这个项目下已经有 ${hit.name} 这条登记了`, 'depName');
}

function sortDeps(list) {
  return list.slice().sort((a, b) => {
    if (a.projectId !== b.projectId) return a.projectId < b.projectId ? -1 : 1;
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
}

// 依赖清单：支持按项目、状态、许可筛选，再按依赖名或责任人搜索
function listDeps(options) {
  const input = options && typeof options === 'object' ? options : {};
  const projectId = pickText(input.projectId);
  const status = pickText(input.status);
  const license = pickText(input.license);
  const keyword = pickText(input.keyword).toLowerCase();
  const data = load();

  let list = data.deps;
  if (projectId) list = list.filter((item) => item.projectId === projectId);
  if (status) list = list.filter((item) => item.status === status);
  if (license) list = list.filter((item) => item.license === license);
  if (keyword) {
    list = list.filter((item) => item.name.toLowerCase().includes(keyword)
      || item.owner.toLowerCase().includes(keyword)
      || item.note.toLowerCase().includes(keyword));
  }

  const licenses = Array.from(new Set(data.deps.map((item) => item.license).filter(Boolean))).sort();
  const projects = data.projects
    .map((item) => ({ id: item.id, name: item.name, owner: item.owner }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));

  return { deps: sortDeps(list), projects, licenses, statuses: STATUSES.slice() };
}

function getDep(id) {
  const data = load();
  const found = data.deps.find((item) => item.id === id);
  if (!found) throw new ApiError(404, 'DEP_NOT_FOUND', '这条依赖登记不存在或已被删除', '');
  return found;
}

function createDep(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const project = findProject(data, input.projectId);
  const name = validateName(input.name);
  assertNameFree(data, project.id, name, '');

  const now = new Date().toISOString();
  const created = {
    id: crypto.randomUUID(),
    projectId: project.id,
    name,
    version: validateVersion(input.version),
    license: validateLicense(input.license),
    owner: validateOwner(input.owner),
    status: validateStatus(input.status),
    note: validateNote(input.note),
    createdAt: now,
    updatedAt: now,
  };
  data.deps.push(created);
  save(data);
  return created;
}

function updateDep(id, payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const found = data.deps.find((item) => item.id === id);
  if (!found) throw new ApiError(404, 'DEP_NOT_FOUND', '这条依赖登记不存在或已被删除', '');

  const project = input.projectId === undefined ? null : findProject(data, input.projectId);
  const projectId = project ? project.id : found.projectId;
  const name = input.name === undefined ? found.name : validateName(input.name);
  assertNameFree(data, projectId, name, found.id);

  found.projectId = projectId;
  found.name = name;
  found.version = input.version === undefined ? found.version : validateVersion(input.version);
  found.license = input.license === undefined ? found.license : validateLicense(input.license);
  const nextOwner = input.owner === undefined ? found.owner : validateOwner(input.owner);
  found.status = input.status === undefined ? found.status : validateStatus(input.status);
  found.note = input.note === undefined ? found.note : validateNote(input.note);

  // 责任人发生变化（含改成空、即撤掉责任人）同样按转交留痕；操作者没填不拦编辑，只影响记录里的署名
  const previousOwner = found.owner || '';
  if (nextOwner !== previousOwner) {
    const operator = validateOwner(input.operator);
    transfers.recordSingleOwnerChange(data, found, previousOwner, nextOwner, operator);
    found.owner = nextOwner;
  }

  found.updatedAt = new Date().toISOString();
  save(data);
  return found;
}

function deleteDep(id) {
  const data = load();
  const index = data.deps.findIndex((item) => item.id === id);
  if (index === -1) throw new ApiError(404, 'DEP_NOT_FOUND', '这条依赖登记不存在或已被删除', '');
  const [removed] = data.deps.splice(index, 1);
  save(data);
  return { id: removed.id, name: removed.name };
}

module.exports = {
  listDeps,
  getDep,
  createDep,
  updateDep,
  deleteDep,
  validateName,
  validateVersion,
};
