const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const TEMP_FILE = path.join(DATA_DIR, 'db.json.tmp');

const MAX_NAME_LENGTH = 60;
const MAX_VERSION_LENGTH = 40;
const MAX_LICENSE_LENGTH = 40;
const MAX_OWNER_LENGTH = 40;
const MAX_NOTE_LENGTH = 200;
const UNASSIGNED = '未指定';
const STATUSES = ['在用', '待升', '已弃用'];

// 初始数据：三个项目、十八条依赖登记。里面故意留了几种情况：
// 同一个依赖在两个项目里版本不一致、几条没写责任人、一条没写许可、
// 一条停在待升状态很久、一条已经弃用，另一种是同一依赖只在单个项目里出现过
function seedData() {
  return {
    projects: [
      { id: 'proj-1001', name: '订单服务', owner: '陈晓', note: '下单与订单查询', createdAt: '2026-08-28T02:00:00.000Z' },
      { id: 'proj-1002', name: '支付网关', owner: '李文', note: '收单与退款通道', createdAt: '2026-08-28T02:10:00.000Z' },
      { id: 'proj-1003', name: '会员中心', owner: '王凯', note: '账号与权益', createdAt: '2026-08-28T02:20:00.000Z' },
    ],
    deps: [
      { id: 'dep-2001', projectId: 'proj-1001', name: 'spring-boot', version: '2.7.18', license: 'Apache-2.0', owner: '陈晓', status: '在用', note: '基础框架', createdAt: '2026-08-28T03:00:00.000Z', updatedAt: '2026-09-15T06:10:00.000Z' },
      { id: 'dep-2002', projectId: 'proj-1001', name: 'postgresql', version: '42.6.0', license: 'BSD-2-Clause', owner: '陈晓', status: '在用', note: '数据库驱动', createdAt: '2026-08-28T03:02:00.000Z', updatedAt: '2026-09-15T06:12:00.000Z' },
      { id: 'dep-2003', projectId: 'proj-1001', name: 'redis-client', version: '3.1.0', license: 'MIT', owner: '', status: '待升', note: '等缓存改造完成后一起升', createdAt: '2026-08-29T01:20:00.000Z', updatedAt: '2026-08-20T02:30:00.000Z' },
      { id: 'dep-2004', projectId: 'proj-1001', name: 'jackson-databind', version: '2.15.3', license: 'Apache-2.0', owner: '陈晓', status: '在用', note: '结构化内容读写', createdAt: '2026-08-29T01:22:00.000Z', updatedAt: '2026-09-12T03:40:00.000Z' },
      { id: 'dep-2005', projectId: 'proj-1001', name: 'internal-sdk', version: '0.4.1', license: '', owner: '陈晓', status: '在用', note: '内部埋点封装，许可还没确认', createdAt: '2026-08-30T02:00:00.000Z', updatedAt: '2026-09-11T08:20:00.000Z' },
      { id: 'dep-2006', projectId: 'proj-1002', name: 'spring-boot', version: '2.6.15', license: 'Apache-2.0', owner: '李文', status: '在用', note: '基础框架，比订单服务低一档', createdAt: '2026-08-28T03:30:00.000Z', updatedAt: '2026-09-14T05:05:00.000Z' },
      { id: 'dep-2007', projectId: 'proj-1002', name: 'netty', version: '4.1.100', license: 'Apache-2.0', owner: '李文', status: '在用', note: '长连接通道', createdAt: '2026-08-28T03:32:00.000Z', updatedAt: '2026-09-14T05:08:00.000Z' },
      { id: 'dep-2008', projectId: 'proj-1002', name: 'bouncy-castle', version: '1.70', license: 'MIT', owner: '李文', status: '待升', note: '等安全评估结论', createdAt: '2026-08-30T06:00:00.000Z', updatedAt: '2026-08-25T07:15:00.000Z' },
      { id: 'dep-2009', projectId: 'proj-1002', name: 'postgresql', version: '42.6.0', license: 'BSD-2-Clause', owner: '李文', status: '在用', note: '数据库驱动', createdAt: '2026-08-28T03:35:00.000Z', updatedAt: '2026-09-09T09:00:00.000Z' },
      { id: 'dep-2010', projectId: 'proj-1002', name: 'protobuf-java', version: '3.24.4', license: 'BSD-3-Clause', owner: '', status: '在用', note: '通道报文编解码', createdAt: '2026-08-30T06:05:00.000Z', updatedAt: '2026-09-09T09:05:00.000Z' },
      { id: 'dep-2011', projectId: 'proj-1003', name: 'react', version: '18.2.0', license: 'MIT', owner: '王凯', status: '在用', note: '页面框架', createdAt: '2026-08-28T04:00:00.000Z', updatedAt: '2026-09-16T02:00:00.000Z' },
      { id: 'dep-2012', projectId: 'proj-1003', name: 'axios', version: '1.6.2', license: 'MIT', owner: '王凯', status: '在用', note: '请求封装', createdAt: '2026-08-28T04:02:00.000Z', updatedAt: '2026-09-16T02:02:00.000Z' },
      { id: 'dep-2013', projectId: 'proj-1003', name: 'lodash', version: '4.17.21', license: 'MIT', owner: '', status: '待升', note: '很多地方直接引了整个包', createdAt: '2026-08-29T08:00:00.000Z', updatedAt: '2026-08-18T03:30:00.000Z' },
      { id: 'dep-2014', projectId: 'proj-1003', name: 'moment', version: '2.29.4', license: 'MIT', owner: '王凯', status: '已弃用', note: '体积太大，计划整体换成 dayjs', createdAt: '2026-08-29T08:05:00.000Z', updatedAt: '2026-09-10T01:00:00.000Z' },
      { id: 'dep-2015', projectId: 'proj-1003', name: 'dayjs', version: '1.11.10', license: 'MIT', owner: '王凯', status: '在用', note: '替换 moment 后的时间处理', createdAt: '2026-09-10T01:05:00.000Z', updatedAt: '2026-09-10T01:05:00.000Z' },
      { id: 'dep-2016', projectId: 'proj-1003', name: 'typescript', version: '5.2.2', license: 'Apache-2.0', owner: '王凯', status: '在用', note: '编译与类型检查', createdAt: '2026-08-28T04:10:00.000Z', updatedAt: '2026-09-08T07:40:00.000Z' },
      { id: 'dep-2017', projectId: 'proj-1003', name: 'vite', version: '5.0.10', license: 'MIT', owner: '王凯', status: '在用', note: '本地构建', createdAt: '2026-08-28T04:12:00.000Z', updatedAt: '2026-09-08T07:42:00.000Z' },
      { id: 'dep-2018', projectId: 'proj-1003', name: 'xml-parser', version: '0.9.2', license: 'GPL-3.0', owner: '', status: '在用', note: '解析对账文件用，许可需要复核', createdAt: '2026-09-01T02:00:00.000Z', updatedAt: '2026-09-08T07:50:00.000Z' },
    ],
    transfers: [],
  };
}

// 把单个项目整理成固定结构，避免数据文件被手工改动后出现缺字段
function normalizeProject(item, fallbackIndex) {
  const source = item && typeof item === 'object' ? item : {};
  const createdAt = typeof source.createdAt === 'string' && source.createdAt ? source.createdAt : new Date().toISOString();
  return {
    id: typeof source.id === 'string' && source.id ? source.id : `proj-restored-${fallbackIndex + 1}`,
    name: typeof source.name === 'string' && source.name.trim() ? source.name.trim() : `未命名项目 ${fallbackIndex + 1}`,
    owner: typeof source.owner === 'string' ? source.owner.trim() : '',
    note: typeof source.note === 'string' ? source.note : '',
    createdAt,
  };
}

// 把单条依赖登记整理成固定结构，状态不认识的一律按在用处理
function normalizeDep(item, fallbackIndex) {
  const source = item && typeof item === 'object' ? item : {};
  const createdAt = typeof source.createdAt === 'string' && source.createdAt ? source.createdAt : new Date().toISOString();
  const status = STATUSES.includes(source.status) ? source.status : STATUSES[0];
  return {
    id: typeof source.id === 'string' && source.id ? source.id : `dep-restored-${fallbackIndex + 1}`,
    projectId: typeof source.projectId === 'string' ? source.projectId : '',
    name: typeof source.name === 'string' ? source.name.trim() : '',
    version: typeof source.version === 'string' ? source.version.trim() : '',
    license: typeof source.license === 'string' ? source.license.trim() : '',
    owner: typeof source.owner === 'string' ? source.owner.trim() : '',
    status,
    note: typeof source.note === 'string' ? source.note : '',
    createdAt,
    updatedAt: typeof source.updatedAt === 'string' && source.updatedAt ? source.updatedAt : createdAt,
  };
}

// 转交记录里的每一条明细：登记以后可能被删掉，这里把项目名与依赖名当时的样子留下来
function normalizeTransferItem(item) {
  const source = item && typeof item === 'object' ? item : {};
  const depId = typeof source.depId === 'string' ? source.depId : '';
  const name = typeof source.name === 'string' ? source.name : '';
  if (!depId || !name) return null;
  return {
    depId,
    projectId: typeof source.projectId === 'string' ? source.projectId : '',
    projectName: typeof source.projectName === 'string' ? source.projectName : '',
    name,
    fromOwner: typeof source.fromOwner === 'string' ? source.fromOwner : '',
  };
}

// 一次转交的痕迹：什么时候、由谁、转给了谁（空表示撤掉责任人）、动了哪些登记
function normalizeTransfer(item, fallbackIndex) {
  const source = item && typeof item === 'object' ? item : {};
  const items = Array.isArray(source.items) ? source.items.map(normalizeTransferItem).filter(Boolean) : [];
  if (!items.length) return null;
  return {
    id: typeof source.id === 'string' && source.id ? source.id : `transfer-restored-${fallbackIndex + 1}`,
    at: typeof source.at === 'string' && source.at ? source.at : new Date().toISOString(),
    operator: typeof source.operator === 'string' ? source.operator : '',
    toOwner: typeof source.toOwner === 'string' ? source.toOwner : '',
    items,
  };
}

// 整份数据保证 projects、deps 与 transfers 结构一致，指向不存在项目的登记一律丢掉
function normalize(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const seed = seedData();

  const projects = Array.isArray(source.projects)
    ? source.projects.map((item, index) => normalizeProject(item, index))
    : seed.projects;

  const seenIds = new Set();
  const seenNames = new Set();
  const dedupedProjects = [];
  projects.forEach((item) => {
    const lowerName = item.name.toLowerCase();
    if (seenIds.has(item.id) || seenNames.has(lowerName)) return;
    seenIds.add(item.id);
    seenNames.add(lowerName);
    dedupedProjects.push(item);
  });

  const known = new Set(dedupedProjects.map((item) => item.id));
  const deps = Array.isArray(source.deps)
    ? source.deps
        .map((item, index) => normalizeDep(item, index))
        .filter((item) => item.id && item.name)
        .filter((item) => known.has(item.projectId))
    : [];

  // 转交记录是历史痕迹，登记后来删掉也不影响，整批保留
  const transfers = Array.isArray(source.transfers)
    ? source.transfers.map((item, index) => normalizeTransfer(item, index)).filter(Boolean)
    : [];

  return { projects: dedupedProjects, deps, transfers };
}

// 读取数据文件：文件缺失或内容损坏时回落到初始数据并立刻补写
function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return normalize(JSON.parse(raw));
  } catch (err) {
    const data = seedData();
    save(data);
    return data;
  }
}

// 先写临时文件再改名，写入中途被打断也不会把正式数据文件写坏
function save(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const text = `${JSON.stringify(normalize(data), null, 2)}\n`;
  fs.writeFileSync(TEMP_FILE, text, 'utf8');
  fs.renameSync(TEMP_FILE, DATA_FILE);
}

module.exports = {
  load,
  save,
  seedData,
  normalize,
  normalizeProject,
  normalizeDep,
  normalizeTransfer,
  STATUSES,
  UNASSIGNED,
  MAX_NAME_LENGTH,
  MAX_VERSION_LENGTH,
  MAX_LICENSE_LENGTH,
  MAX_OWNER_LENGTH,
  MAX_NOTE_LENGTH,
  DATA_FILE,
};
