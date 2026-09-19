const path = require('path');
const express = require('express');
const api = require('./api');

const app = express();
const PORT = process.env.PORT || 5084;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// 健康检查：页面右上角据此显示服务连接状态
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, port: PORT });
});

app.get('/api/projects', (_req, res) => {
  res.json({ projects: api.listProjects() });
});

app.post('/api/projects', (req, res) => {
  try {
    res.status(201).json(api.createProject(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.patch('/api/projects/:id', (req, res) => {
  try {
    res.json(api.updateProject(req.params.id, req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.delete('/api/projects/:id', (req, res) => {
  try {
    res.json(api.deleteProject(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

// 依赖清单：按项目、状态、许可筛选，再按依赖名或责任人搜索
app.get('/api/deps', (req, res) => {
  const result = api.listDeps({
    projectId: api.readQuery(req.query, 'projectId'),
    status: api.readQuery(req.query, 'status'),
    license: api.readQuery(req.query, 'license'),
    keyword: api.readQuery(req.query, 'keyword'),
  });
  res.json(result);
});

app.post('/api/deps', (req, res) => {
  try {
    res.status(201).json(api.createDep(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/deps/:id', (req, res) => {
  try {
    res.json(api.getDep(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

app.patch('/api/deps/:id', (req, res) => {
  try {
    res.json(api.updateDep(req.params.id, req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.delete('/api/deps/:id', (req, res) => {
  try {
    res.json(api.deleteDep(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

// 按责任人汇总：每个人名下条数与明细，空责任人单独成“未指定”一组
app.get('/api/owners', (_req, res) => {
  res.json(api.listOwners());
});

// 批量转交预演：只算会改哪些登记、转交前后各责任人的条数，不写任何数据
app.post('/api/transfers/preview', (req, res) => {
  try {
    res.json(api.previewTransfer(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

// 执行批量转交：改责任人并留下转交记录
app.post('/api/transfers', (req, res) => {
  try {
    res.status(201).json(api.executeTransfer(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

// 转交记录：按批次倒序，看得出什么时候、由谁、把哪些登记转给了谁
app.get('/api/transfers', (req, res) => {
  res.json(api.listTransfers({ limit: api.readQuery(req.query, 'limit') }));
});

// 未匹配到的接口路径统一返回说明，避免前端拿到一串页面内容
app.use('/api', (_req, res) => {
  res.status(404).json({ error: { code: 'API_NOT_FOUND', message: '接口不存在', field: '' } });
});

// 统一错误出口：业务异常按状态码与错误码返回，其余按服务异常处理
function sendError(res, err) {
  if (err instanceof api.ApiError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, field: err.field },
    });
  }
  console.error('[tp84] 处理请求时出现未预期的问题：', err);
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: '服务内部异常，请稍后重试', field: '' },
  });
}

// 请求体解析失败时给出明确说明
app.use((err, _req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { code: 'BODY_INVALID_JSON', message: '提交的内容不是合法的 JSON', field: '' },
    });
  }
  if (err) return sendError(res, err);
  return next();
});

app.listen(PORT, () => {
  console.log(`依赖台账与版本核查平台已启动：http://localhost:${PORT}`);
});
