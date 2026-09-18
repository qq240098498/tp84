const crypto = require('crypto');
const { load, save, MAX_OWNER_LENGTH, MAX_NOTE_LENGTH } = require('./store');
const { ApiError, pickText } = require('./errors');

const MAX_PROJECT_NAME_LENGTH = 40;

function validateProjectName(value, data, selfId) {
  const name = pickText(value);
  if (!name) throw new ApiError(400, 'PROJECT_NAME_REQUIRED', '请填写项目名称', 'projectName');
  if (name.length > MAX_PROJECT_NAME_LENGTH) {
    throw new ApiError(400, 'PROJECT_NAME_TOO_LONG', `项目名称不能超过 ${MAX_PROJECT_NAME_LENGTH} 个字符`, 'projectName');
  }
  const hit = data.projects.find((item) => item.id !== selfId && item.name.toLowerCase() === name.toLowerCase());
  if (hit) throw new ApiError(409, 'PROJECT_NAME_DUPLICATED', `已经有一个叫 ${hit.name} 的项目了`, 'projectName');
  return name;
}

function validateOwner(value) {
  const owner = pickText(value);
  if (owner.length > MAX_OWNER_LENGTH) {
    throw new ApiError(400, 'OWNER_TOO_LONG', `负责人名字不能超过 ${MAX_OWNER_LENGTH} 个字符`, 'projectOwner');
  }
  return owner;
}

function validateNote(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new ApiError(400, 'NOTE_INVALID', '说明需要是文本', 'projectNote');
  if (value.length > MAX_NOTE_LENGTH) {
    throw new ApiError(400, 'NOTE_TOO_LONG', `说明不能超过 ${MAX_NOTE_LENGTH} 个字符`, 'projectNote');
  }
  return value.trim();
}

// 项目清单带上每个项目下已经登记的依赖条数，页面上直接看得出哪个项目还没登记
function listProjects() {
  const data = load();
  const counts = {};
  data.deps.forEach((item) => {
    counts[item.projectId] = (counts[item.projectId] || 0) + 1;
  });
  return data.projects.map((item) => ({ ...item, depCount: counts[item.id] || 0 }));
}

function findProject(data, id, field) {
  const value = pickText(id);
  if (!value) throw new ApiError(400, 'PROJECT_REQUIRED', '请选择所属项目', field || 'projectId');
  const found = data.projects.find((item) => item.id === value);
  if (!found) throw new ApiError(404, 'PROJECT_NOT_FOUND', '这个项目没有登记过，请先在项目区登记', field || 'projectId');
  return found;
}

function createProject(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const name = validateProjectName(input.name, data, '');
  const owner = validateOwner(input.owner);
  const note = validateNote(input.note);

  const created = {
    id: crypto.randomUUID(),
    name,
    owner,
    note,
    createdAt: new Date().toISOString(),
  };
  data.projects.push(created);
  save(data);
  return created;
}

function updateProject(id, payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const found = data.projects.find((item) => item.id === id);
  if (!found) throw new ApiError(404, 'PROJECT_NOT_FOUND', '这个项目没有登记过', 'projectId');

  found.name = input.name === undefined ? found.name : validateProjectName(input.name, data, found.id);
  found.owner = input.owner === undefined ? found.owner : validateOwner(input.owner);
  found.note = input.note === undefined ? found.note : validateNote(input.note);
  save(data);
  return found;
}

function deleteProject(id) {
  const data = load();
  const found = data.projects.find((item) => item.id === id);
  if (!found) throw new ApiError(404, 'PROJECT_NOT_FOUND', '这个项目没有登记过', 'projectId');

  // 项目下面还挂着依赖登记时不允许直接删，先把登记清掉再删
  const using = data.deps.filter((item) => item.projectId === found.id);
  if (using.length) {
    const samples = using.slice(0, 3).map((item) => item.name).join('、');
    throw new ApiError(409, 'PROJECT_IN_USE', `${found.name} 下面还有 ${using.length} 条依赖登记，例如 ${samples}，请先处理这些登记再删除项目`, 'projectId');
  }

  data.projects = data.projects.filter((item) => item.id !== found.id);
  save(data);
  return { id: found.id, name: found.name };
}

module.exports = {
  listProjects,
  findProject,
  createProject,
  updateProject,
  deleteProject,
};
