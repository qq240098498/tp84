// 页面交互：项目清单、依赖登记、责任人汇总与转交都从服务端拉取，
// 任何一步失败都把说明显示在顶部并标到对应输入项上

const state = {
  projects: [],
  deps: [],
  licenses: [],
  statuses: [],
  editingId: '',
  ownerGroups: [],
  ownerTotal: 0,
  selectedIds: new Set(),
  expandedOwners: new Set(),
  transferBatches: [],
  expandedLogs: new Set(),
  previewPlan: null,
};

const el = (id) => document.getElementById(id);

// 统一的请求入口：出错时把服务端给的错误码、说明与出错位置一起抛出去
async function request(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch (err) {
    payload = null;
  }
  if (!res.ok) {
    const error = (payload && payload.error) || {};
    const failure = new Error(error.message || `请求失败（状态码 ${res.status}）`);
    failure.code = error.code || '';
    failure.field = error.field || '';
    throw failure;
  }
  return payload;
}

function notify(message, kind) {
  const box = el('notice');
  box.textContent = message;
  box.className = `notice ${kind === 'ok' ? 'ok' : 'error'}`;
}

function clearNotice() {
  const box = el('notice');
  box.className = 'notice hidden';
  box.textContent = '';
}

function clearFieldMarks() {
  document.querySelectorAll('.invalid').forEach((node) => node.classList.remove('invalid'));
}

// 把出错位置标到具体输入项上：项目区与依赖区共用一套标记
function markField(field) {
  if (!field) return;
  const target = document.querySelector(`[data-field="${field}"]`);
  if (!target) return;
  target.classList.add('invalid');
  const input = target.tagName === 'INPUT' || target.tagName === 'SELECT' ? target : target.querySelector('input, select');
  if (input) input.focus();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ownerText(owner) {
  return owner ? escapeHtml(owner) : '<span class="missing">未指定</span>';
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (num) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 操作者名字记在浏览器里，刷新之后还在，保存时随请求一起带上
const OPERATOR_KEY = 'dep-ledger-operator';

function currentOperator() {
  return el('operator').value.trim();
}

function restoreOperator() {
  el('operator').value = window.localStorage.getItem(OPERATOR_KEY) || '';
}

async function loadHealth() {
  try {
    await request('/api/health');
    el('health').textContent = '服务正常';
    el('health').className = 'health ok';
  } catch (err) {
    el('health').textContent = '服务连不上';
    el('health').className = 'health bad';
  }
}

async function loadProjects() {
  const payload = await request('/api/projects');
  state.projects = payload.projects || [];
  renderProjects();
  renderProjectOptions();
}

async function loadDeps() {
  const params = new URLSearchParams();
  const projectId = el('filter-project').value;
  const status = el('filter-status').value;
  const license = el('filter-license').value;
  const keyword = el('filter-keyword').value.trim();
  if (projectId) params.set('projectId', projectId);
  if (status) params.set('status', status);
  if (license) params.set('license', license);
  if (keyword) params.set('keyword', keyword);
  const query = params.toString();
  const payload = await request(`/api/deps${query ? `?${query}` : ''}`);
  state.deps = payload.deps || [];
  state.licenses = payload.licenses || [];
  state.statuses = payload.statuses || [];
  renderDepFilterOptions();
  renderDeps();
}

// 责任人分组与转交记录
async function loadOwners() {
  const payload = await request('/api/owners');
  state.ownerGroups = payload.groups || [];
  state.ownerTotal = payload.total || 0;
  // 已经删掉的登记要从勾选里剔除，避免拿着旧编号去转交
  const liveIds = new Set(state.ownerGroups.flatMap((group) => group.items.map((item) => item.id)));
  state.selectedIds = new Set(Array.from(state.selectedIds).filter((id) => liveIds.has(id)));
  renderOwnerGroups();
  updateSelectionUi();
}

async function loadTransferLogs() {
  const payload = await request('/api/transfers?limit=50');
  state.transferBatches = payload.batches || [];
  renderTransferLogs();
}

function renderProjects() {
  const body = el('project-body');
  body.innerHTML = state.projects.map((item) => `<tr>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.owner) || '<span class="missing">未指定</span>'}</td>
      <td class="note-cell">${escapeHtml(item.note)}</td>
      <td>${item.depCount} 条</td>
      <td class="mono">${escapeHtml(formatTime(item.createdAt))}</td>
      <td class="actions">
        <button type="button" class="link" data-project-rename="${escapeHtml(item.id)}">改名</button>
        <button type="button" class="link" data-project-owner="${escapeHtml(item.id)}">改负责人</button>
        <button type="button" class="link danger" data-project-delete="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`).join('');
  el('project-empty').classList.toggle('hidden', state.projects.length > 0);
}

function renderProjectOptions() {
  const select = el('dep-project');
  const current = select.value;
  select.innerHTML = state.projects
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`)
    .join('');
  if (state.projects.some((item) => item.id === current)) select.value = current;

  const filter = el('filter-project');
  const filterCurrent = filter.value;
  filter.innerHTML = '<option value="">全部项目</option>'
    + state.projects.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
  if (state.projects.some((item) => item.id === filterCurrent)) filter.value = filterCurrent;
}

function renderDepFilterOptions() {
  const statusSelect = el('filter-status');
  const statusCurrent = statusSelect.value;
  statusSelect.innerHTML = '<option value="">全部状态</option>'
    + state.statuses.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.statuses.includes(statusCurrent)) statusSelect.value = statusCurrent;

  const licenseSelect = el('filter-license');
  const licenseCurrent = licenseSelect.value;
  licenseSelect.innerHTML = '<option value="">全部许可</option>'
    + state.licenses.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.licenses.includes(licenseCurrent)) licenseSelect.value = licenseCurrent;

  const statusForm = el('dep-status');
  const statusFormCurrent = statusForm.value;
  statusForm.innerHTML = state.statuses
    .map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`)
    .join('');
  if (state.statuses.includes(statusFormCurrent)) statusForm.value = statusFormCurrent;
}

function projectName(projectId) {
  const found = state.projects.find((item) => item.id === projectId);
  return found ? found.name : projectId;
}

function renderDeps() {
  const body = el('dep-body');
  body.innerHTML = state.deps.map((item) => {
    const statusTag = item.status === '已弃用' ? 'off' : 'on';
    return `<tr>
      <td>${escapeHtml(projectName(item.projectId))}</td>
      <td class="mono">${escapeHtml(item.name)}</td>
      <td class="mono">${escapeHtml(item.version)}</td>
      <td>${item.license ? escapeHtml(item.license) : '<span class="missing">未填</span>'}</td>
      <td>${item.owner ? escapeHtml(item.owner) : '<span class="missing">未指定</span>'}</td>
      <td><span class="tag ${statusTag}">${escapeHtml(item.status)}</span></td>
      <td class="note-cell">${escapeHtml(item.note)}</td>
      <td class="mono">${escapeHtml(formatTime(item.updatedAt))}</td>
      <td class="actions">
        <button type="button" class="link" data-dep-edit="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="link danger" data-dep-delete="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`;
  }).join('');
  el('dep-empty').classList.toggle('hidden', state.deps.length > 0);
}

// ---------- 责任人分组 ----------

function renderOwnerGroups() {
  const box = el('owner-groups');
  el('owner-empty').classList.toggle('hidden', state.ownerTotal > 0);
  box.innerHTML = state.ownerGroups.map((group, groupIndex) => {
    const expanded = state.expandedOwners.has(group.owner);
    const selectedInGroup = group.items.filter((item) => state.selectedIds.has(item.id)).length;
    const allChecked = group.items.length > 0 && selectedInGroup === group.items.length;
    const someChecked = selectedInGroup > 0 && !allChecked;
    return `<div class="owner-group${group.owner ? '' : ' unassigned'}">
      <div class="group-head">
        <label class="group-check"><input type="checkbox" data-group-check="${groupIndex}"${allChecked ? ' checked' : ''} data-indeterminate="${someChecked ? '1' : '0'}"></label>
        <button type="button" class="group-caret" data-group-toggle="${groupIndex}" aria-expanded="${expanded}">${expanded ? '▾' : '▸'}</button>
        <span class="group-name">${ownerText(group.owner)}</span>
        <span class="group-count">${group.count} 条</span>
        <span class="group-selected">${selectedInGroup ? `已选 ${selectedInGroup} 条` : ''}</span>
      </div>
      <div class="group-body ${expanded ? '' : 'hidden'}">
        <table class="grid inner-grid">
          <thead>
            <tr>
              <th class="check-col"></th>
              <th>项目</th>
              <th>依赖名称</th>
              <th>版本</th>
              <th>许可</th>
              <th>状态</th>
              <th>备注</th>
              <th>更新时间</th>
            </tr>
          </thead>
          <tbody>
            ${group.items.map((item) => {
              const statusTag = item.status === '已弃用' ? 'off' : 'on';
              return `<tr>
                <td class="check-col"><input type="checkbox" data-dep-check="${escapeHtml(item.id)}"${state.selectedIds.has(item.id) ? ' checked' : ''}></td>
                <td>${escapeHtml(item.projectName)}</td>
                <td class="mono">${escapeHtml(item.name)}</td>
                <td class="mono">${escapeHtml(item.version)}</td>
                <td>${item.license ? escapeHtml(item.license) : '<span class="missing">未填</span>'}</td>
                <td><span class="tag ${statusTag}">${escapeHtml(item.status)}</span></td>
                <td class="note-cell">${escapeHtml(item.note)}</td>
                <td class="mono">${escapeHtml(formatTime(item.updatedAt))}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  }).join('');

  // indeterminate 只能在元素插到页面上之后设置
  box.querySelectorAll('input[data-group-check]').forEach((node) => {
    node.indeterminate = node.dataset.indeterminate === '1';
  });
}

// 勾选变化后只刷计数与组选框，不整表重绘，避免展开的组被收起
function updateSelectionUi() {
  el('transfer-count').textContent = String(state.selectedIds.size);
  el('owner-groups').querySelectorAll('.owner-group').forEach((groupNode, groupIndex) => {
    const group = state.ownerGroups[groupIndex];
    if (!group) return;
    const selectedInGroup = group.items.filter((item) => state.selectedIds.has(item.id)).length;
    const check = groupNode.querySelector('input[data-group-check]');
    if (check) {
      check.checked = group.items.length > 0 && selectedInGroup === group.items.length;
      check.indeterminate = selectedInGroup > 0 && !check.checked;
    }
    const tip = groupNode.querySelector('.group-selected');
    if (tip) tip.textContent = selectedInGroup ? `已选 ${selectedInGroup} 条` : '';
  });
}

// ---------- 批量转交预演 ----------

function openPreview(plan) {
  state.previewPlan = plan;
  el('preview-mask').classList.remove('hidden');
  renderPreview();
}

function closePreview() {
  state.previewPlan = null;
  el('preview-mask').classList.add('hidden');
}

function renderPreview() {
  const plan = state.previewPlan;
  const body = el('preview-body');
  if (!plan) {
    body.innerHTML = '';
    return;
  }
  const toOwner = plan.toOwner;
  const unassign = !toOwner;
  const skipRows = plan.skipCount
    ? `<p class="preview-note">另有 ${plan.skipCount} 条已经在${unassign ? '未指定' : escapeHtml(toOwner)}名下，执行时会自动跳过，不会重复留痕。</p>`
    : '';

  body.innerHTML = `
    <div class="preview-summary ${unassign ? 'warn' : ''}">
      <div>本次勾选 <strong>${plan.foundCount}</strong> 条登记（选中 ${plan.requestedCount} 个编号${plan.missingCount ? `，其中 ${plan.missingCount} 条已不存在` : ''}）</div>
      <div>将有 <strong>${plan.changeCount}</strong> 条${unassign ? '撤掉责任人，回到「未指定」一组' : `转交给 <strong>${escapeHtml(toOwner)}</strong>`}</div>
    </div>
    ${skipRows}
    <h4 class="preview-h">转交前后条数对账（只列受影响的责任人）</h4>
    <table class="grid inner-grid">
      <thead>
        <tr><th>责任人</th><th>转交前</th><th>转交后</th><th>变化</th></tr>
      </thead>
      <tbody>
        ${plan.counts.affected.map((row) => `<tr>
          <td>${ownerText(row.owner)}</td>
          <td class="mono">${row.before} 条</td>
          <td class="mono">${row.after} 条</td>
          <td class="mono delta ${row.delta > 0 ? 'up' : row.delta < 0 ? 'down' : ''}">${row.delta > 0 ? '+' : ''}${row.delta}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <p class="preview-note">全部登记总数始终为 ${sumCounts(plan.counts.before)} 条，转交只换责任人，不增删登记。</p>
    <h4 class="preview-h">将改动的登记</h4>
    <div class="preview-items">
      <table class="grid inner-grid">
        <thead>
          <tr><th>项目</th><th>依赖</th><th>版本</th><th>原责任人</th><th></th><th>新责任人</th></tr>
        </thead>
        <tbody>
          ${plan.items.map((item) => `<tr class="${item.willChange ? '' : 'skip-row'}">
            <td>${escapeHtml(item.projectName)}</td>
            <td class="mono">${escapeHtml(item.name)}</td>
            <td class="mono">${escapeHtml(item.version)}</td>
            <td>${ownerText(item.fromOwner)}</td>
            <td>→</td>
            <td>${ownerText(item.toOwner)}${item.willChange ? '' : ' <span class="missing">（无需改动）</span>'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <label class="preview-reason" data-field="reason">转交备注（可选）
      <input id="preview-reason" maxlength="200" placeholder="例如：模块交接给支付组">
    </label>`;

  const confirmBtn = el('preview-confirm');
  confirmBtn.disabled = plan.changeCount === 0;
  confirmBtn.textContent = unassign ? `确认撤掉这 ${plan.changeCount} 条的责任人` : `确认转交给 ${toOwner}`;
}

function sumCounts(list) {
  return list.reduce((total, item) => total + item.count, 0);
}

async function requestPreview() {
  clearNotice();
  clearFieldMarks();
  if (!state.selectedIds.size) {
    notify('请先在下面的责任人分组里勾选要转交的登记', 'error');
    return;
  }
  const payload = {
    depIds: Array.from(state.selectedIds),
    toOwner: el('transfer-owner').value,
  };
  try {
    const plan = await request('/api/transfers/preview', { method: 'POST', body: JSON.stringify(payload) });
    openPreview(plan);
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

async function confirmTransfer() {
  const plan = state.previewPlan;
  if (!plan || !plan.changeCount) return;
  const operator = currentOperator();
  if (!operator) {
    notify('请先在顶栏填写当前操作者，转交要留下是谁办的', 'error');
    el('operator').focus();
    return;
  }
  const reasonNode = el('preview-reason');
  const payload = {
    depIds: plan.items.map((item) => item.id),
    toOwner: plan.toOwner,
    operator,
    reason: reasonNode ? reasonNode.value : '',
  };
  const confirmBtn = el('preview-confirm');
  confirmBtn.disabled = true;
  confirmBtn.textContent = '正在执行…';
  try {
    const result = await request('/api/transfers', { method: 'POST', body: JSON.stringify(payload) });
    const target = result.toOwner ? result.toOwner : '未指定';
    const affectedText = result.counts.affected
      .filter((row) => row.delta !== 0)
      .map((row) => `${row.owner || '未指定'}：${row.before} → ${row.after}`)
      .join('；');
    closePreview();
    state.selectedIds = new Set();
    el('transfer-owner').value = result.toOwner || '';
    notify(`已把 ${result.changeCount} 条登记转给 ${target}。${affectedText}`, 'ok');
    await refreshAfterChange();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
    confirmBtn.disabled = false;
    confirmBtn.textContent = plan.toOwner ? `确认转交给 ${plan.toOwner}` : `确认撤掉这 ${plan.changeCount} 条的责任人`;
  }
}

// ---------- 转交记录 ----------

function renderTransferLogs() {
  const box = el('transfer-log');
  el('transfer-log-empty').classList.toggle('hidden', state.transferBatches.length > 0);
  box.innerHTML = state.transferBatches.map((batch) => {
    const expanded = state.expandedLogs.has(batch.batchId);
    const fromText = batch.fromGroups.map((group) => `${ownerText(group.owner)} ${group.count} 条`).join('、');
    return `<div class="log-batch">
      <div class="log-head">
        <button type="button" class="group-caret" data-log-toggle="${escapeHtml(batch.batchId)}" aria-expanded="${expanded}">${expanded ? '▾' : '▸'}</button>
        <span class="mono log-time">${escapeHtml(formatTime(batch.at))}</span>
        <span>${escapeHtml(batch.operator)} 把</span>
        <span>${fromText}</span>
        <span>转给</span>
        <span class="log-target">${ownerText(batch.toOwner)}</span>
        <span class="group-count">共 ${batch.count} 条</span>
        ${batch.reason ? `<span class="log-reason">${escapeHtml(batch.reason)}</span>` : ''}
      </div>
      <div class="log-body ${expanded ? '' : 'hidden'}">
        <table class="grid inner-grid">
          <thead>
            <tr><th>项目</th><th>依赖</th><th>版本</th><th>原责任人</th><th></th><th>新责任人</th></tr>
          </thead>
          <tbody>
            ${batch.records.map((record) => `<tr>
              <td>${escapeHtml(record.depSnapshot.projectName)}</td>
              <td class="mono">${escapeHtml(record.depSnapshot.name)}</td>
              <td class="mono">${escapeHtml(record.depSnapshot.version)}</td>
              <td>${ownerText(record.fromOwner)}</td>
              <td>→</td>
              <td>${ownerText(record.toOwner)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  }).join('');
}

async function refreshAfterChange() {
  await loadProjects();
  await loadDeps();
  await loadOwners();
  await loadTransferLogs();
}

function openDepForm(dep) {
  state.editingId = dep ? dep.id : '';
  el('dep-form-title').textContent = dep ? `编辑登记：${dep.name}` : '新建登记';
  if (state.projects.length) {
    el('dep-project').value = dep ? dep.projectId : state.projects[0].id;
  }
  el('dep-name').value = dep ? dep.name : '';
  el('dep-version').value = dep ? dep.version : '';
  el('dep-license').value = dep ? dep.license : '';
  el('dep-owner').value = dep ? dep.owner : currentOperator();
  el('dep-status').value = dep ? dep.status : (state.statuses[0] || '在用');
  el('dep-note').value = dep ? dep.note : '';
  el('dep-form').classList.remove('hidden');
  el('dep-name').focus();
}

function closeDepForm() {
  state.editingId = '';
  el('dep-form').classList.add('hidden');
  clearFieldMarks();
}

async function submitProject(event) {
  event.preventDefault();
  clearNotice();
  clearFieldMarks();
  const payload = {
    name: el('project-name').value,
    owner: el('project-owner').value,
    note: el('project-note').value,
  };
  try {
    await request('/api/projects', { method: 'POST', body: JSON.stringify(payload) });
    el('project-name').value = '';
    el('project-owner').value = '';
    el('project-note').value = '';
    notify('项目已新增', 'ok');
    await loadProjects();
    await loadDeps();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

async function submitDep(event) {
  event.preventDefault();
  clearNotice();
  clearFieldMarks();
  const payload = {
    projectId: el('dep-project').value,
    name: el('dep-name').value,
    version: el('dep-version').value,
    license: el('dep-license').value,
    owner: el('dep-owner').value,
    operator: currentOperator(),
    status: el('dep-status').value,
    note: el('dep-note').value,
  };
  const editing = state.editingId;
  try {
    if (editing) {
      await request(`/api/deps/${encodeURIComponent(editing)}`, { method: 'PATCH', body: JSON.stringify(payload) });
      notify('依赖登记已保存', 'ok');
    } else {
      await request('/api/deps', { method: 'POST', body: JSON.stringify(payload) });
      notify('依赖登记已新增', 'ok');
    }
    closeDepForm();
    await refreshAfterChange();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

// 列表上的操作用事件委托统一处理，列表重绘之后不需要重新绑定
document.addEventListener('click', async (event) => {
  const node = event.target.closest('button');
  if (!node) return;

  // 责任人分组：展开/收起
  if (node.dataset.groupToggle !== undefined) {
    const group = state.ownerGroups[Number(node.dataset.groupToggle)];
    if (!group) return;
    if (state.expandedOwners.has(group.owner)) state.expandedOwners.delete(group.owner);
    else state.expandedOwners.add(group.owner);
    renderOwnerGroups();
    return;
  }

  // 转交记录：展开/收起
  if (node.dataset.logToggle !== undefined) {
    const batchId = node.dataset.logToggle;
    if (state.expandedLogs.has(batchId)) state.expandedLogs.delete(batchId);
    else state.expandedLogs.add(batchId);
    renderTransferLogs();
    return;
  }

  if (node.id === 'preview-close' || node.id === 'preview-cancel') {
    closePreview();
    return;
  }

  if (node.id === 'preview-confirm') {
    await confirmTransfer();
    return;
  }

  const projectId = node.dataset.projectRename || node.dataset.projectOwner || node.dataset.projectDelete;
  if (projectId) {
    clearNotice();
    const found = state.projects.find((item) => item.id === projectId);
    if (!found) return;
    try {
      if (node.dataset.projectRename) {
        const next = window.prompt(`把 ${found.name} 的名称改成`, found.name);
        if (next === null) return;
        await request(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'PATCH', body: JSON.stringify({ name: next }) });
        notify('项目名称已更新', 'ok');
      } else if (node.dataset.projectOwner) {
        const next = window.prompt(`把 ${found.name} 的负责人改成`, found.owner || '');
        if (next === null) return;
        await request(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'PATCH', body: JSON.stringify({ owner: next }) });
        notify('项目负责人已更新', 'ok');
      } else {
        if (!window.confirm(`确定删除项目 ${found.name} 吗？`)) return;
        await request(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
        notify('项目已删除', 'ok');
      }
      await loadProjects();
      await loadDeps();
      await loadOwners();
    } catch (err) {
      notify(err.message, 'error');
    }
    return;
  }

  if (node.dataset.depEdit) {
    clearNotice();
    const found = state.deps.find((item) => item.id === node.dataset.depEdit);
    if (found) openDepForm(found);
    return;
  }

  if (node.dataset.depDelete) {
    clearNotice();
    const found = state.deps.find((item) => item.id === node.dataset.depDelete);
    if (!window.confirm(`确定删除登记 ${found ? found.name : ''} 吗？`)) return;
    try {
      await request(`/api/deps/${encodeURIComponent(node.dataset.depDelete)}`, { method: 'DELETE' });
      if (state.editingId === node.dataset.depDelete) closeDepForm();
      notify('登记已删除', 'ok');
      await refreshAfterChange();
    } catch (err) {
      notify(err.message, 'error');
    }
  }
});

// 勾选登记与组全选走 change 事件
document.addEventListener('change', (event) => {
  const target = event.target;
  if (target.matches('input[data-dep-check]')) {
    const id = target.dataset.depCheck;
    if (target.checked) state.selectedIds.add(id);
    else state.selectedIds.delete(id);
    updateSelectionUi();
    return;
  }
  if (target.matches('input[data-group-check]')) {
    const group = state.ownerGroups[Number(target.dataset.groupCheck)];
    if (!group) return;
    group.items.forEach((item) => {
      if (target.checked) state.selectedIds.add(item.id);
      else state.selectedIds.delete(item.id);
    });
    renderOwnerGroups();
    updateSelectionUi();
  }
});

// 弹层点遮罩处等同于关闭
el('preview-mask').addEventListener('click', (event) => {
  if (event.target === el('preview-mask')) closePreview();
});

el('project-form').addEventListener('submit', submitProject);
el('dep-form').addEventListener('submit', submitDep);
el('dep-new').addEventListener('click', () => {
  clearNotice();
  if (!state.projects.length) {
    notify('请先登记一个项目，再登记依赖', 'error');
    return;
  }
  openDepForm(null);
});
el('dep-cancel').addEventListener('click', closeDepForm);
el('filter-apply').addEventListener('click', () => {
  clearNotice();
  loadDeps().catch((err) => notify(err.message, 'error'));
});
el('filter-reset').addEventListener('click', () => {
  el('filter-project').value = '';
  el('filter-status').value = '';
  el('filter-license').value = '';
  el('filter-keyword').value = '';
  loadDeps().catch((err) => notify(err.message, 'error'));
});
el('dep-refresh').addEventListener('click', () => {
  clearNotice();
  loadProjects()
    .then(loadDeps)
    .catch((err) => notify(err.message, 'error'));
});
el('filter-project').addEventListener('change', () => {
  loadDeps().catch((err) => notify(err.message, 'error'));
});
el('filter-status').addEventListener('change', () => {
  loadDeps().catch((err) => notify(err.message, 'error'));
});
el('filter-license').addEventListener('change', () => {
  loadDeps().catch((err) => notify(err.message, 'error'));
});
el('operator').addEventListener('change', () => {
  window.localStorage.setItem(OPERATOR_KEY, currentOperator());
});

// 责任人面板上的动作
el('owner-refresh').addEventListener('click', () => {
  clearNotice();
  loadOwners().catch((err) => notify(err.message, 'error'));
});
el('transfer-clear').addEventListener('click', () => {
  state.selectedIds = new Set();
  renderOwnerGroups();
  updateSelectionUi();
});
el('transfer-preview-btn').addEventListener('click', () => { requestPreview(); });

// 转交记录刷新
el('transfer-log-refresh').addEventListener('click', () => {
  loadTransferLogs().catch((err) => notify(err.message, 'error'));
});

// 页面打开时先把项目与依赖登记拉一遍，项目决定登记表单里能选哪些归属
restoreOperator();
loadHealth();
loadProjects()
  .then(loadDeps)
  .then(loadOwners)
  .then(loadTransferLogs)
  .catch((err) => notify(err.message, 'error'));
