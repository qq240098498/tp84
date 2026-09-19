// 页面交互：项目清单与依赖登记都从服务端拉取，任何一步失败都把说明显示在顶部并标到对应输入项上

const state = {
  projects: [],
  deps: [],
  licenses: [],
  statuses: [],
  editingId: '',
  owners: [],
  unassigned: { count: 0, deps: [] },
  ownerTotal: 0,
  transfers: [],
  expandedOwners: new Set(),
  expandedTransfers: new Set(),
  selected: new Set(),
  preview: null,
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

async function loadOwners() {
  const payload = await request('/api/owners');
  state.owners = payload.owners || [];
  state.unassigned = payload.unassigned || { count: 0, deps: [] };
  state.ownerTotal = payload.total || 0;
  // 已经不在台账里的登记（比如刚被删掉）从选定里清掉，避免转交时带上有问题的条目
  const alive = new Set();
  state.owners.forEach((group) => group.deps.forEach((dep) => alive.add(dep.id)));
  state.unassigned.deps.forEach((dep) => alive.add(dep.id));
  state.selected.forEach((id) => {
    if (!alive.has(id)) state.selected.delete(id);
  });
  renderOwners();
}

async function loadTransfers() {
  const payload = await request('/api/transfers');
  state.transfers = payload.transfers || [];
  renderTransfers();
}

// 空串是未指定那一组的 key
function ownerGroup(owner) {
  if (!owner) return state.unassigned;
  return state.owners.find((group) => group.owner === owner) || { count: 0, deps: [] };
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

function ownerText(owner) {
  return owner || '未指定';
}

// 责任人分组：每个人一行，未指定单独一行且样式区分开，最后一行合计，方便转交前后对数
function renderOwners() {
  const body = el('owner-body');
  const rows = state.owners.map((group) => renderOwnerRow(group.owner, group.deps));
  rows.push(renderOwnerRow('', state.unassigned.deps));
  rows.push(`<tr class="total-row"><td>合计</td><td>${state.ownerTotal} 条</td><td></td></tr>`);
  body.innerHTML = rows.join('');
  el('owner-empty').classList.toggle('hidden', state.ownerTotal > 0);
  el('owner-options').innerHTML = state.owners
    .map((group) => `<option value="${escapeHtml(group.owner)}">`)
    .join('');
  updateTransferCount();
}

function renderOwnerRow(owner, deps) {
  const expanded = state.expandedOwners.has(owner);
  const label = owner ? escapeHtml(owner) : '<span class="missing">未指定（没人负责）</span>';
  let html = `<tr${owner ? '' : ' class="unassigned-row"'}>
    <td>${label}</td>
    <td>${deps.length} 条</td>
    <td><button type="button" class="link" data-owner-toggle="${escapeHtml(owner)}">${expanded ? '收起 ▴' : '展开 ▾'}</button></td>
  </tr>`;
  if (expanded) html += renderOwnerDetail(owner, deps);
  return html;
}

function renderOwnerDetail(owner, deps) {
  if (!deps.length) {
    return '<tr class="owner-detail"><td colspan="3"><p class="empty-tip">这一组现在没有登记</p></td></tr>';
  }
  const allChecked = deps.every((dep) => state.selected.has(dep.id));
  const rows = deps.map((dep) => `<tr>
      <td><input type="checkbox" data-transfer-pick="${escapeHtml(dep.id)}"${state.selected.has(dep.id) ? ' checked' : ''}></td>
      <td>${escapeHtml(dep.projectName)}</td>
      <td class="mono">${escapeHtml(dep.name)}</td>
      <td class="mono">${escapeHtml(dep.version)}</td>
      <td>${dep.license ? escapeHtml(dep.license) : '<span class="missing">未填</span>'}</td>
      <td>${escapeHtml(dep.status)}</td>
    </tr>`).join('');
  return `<tr class="owner-detail"><td colspan="3">
    <table class="sub-grid">
      <thead>
        <tr>
          <th title="全选这一组"><input type="checkbox" data-owner-select-all="${escapeHtml(owner)}"${allChecked ? ' checked' : ''}></th>
          <th>项目</th>
          <th>依赖名称</th>
          <th>版本</th>
          <th>许可</th>
          <th>状态</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </td></tr>`;
}

function updateTransferCount() {
  el('transfer-count').textContent = `已选 ${state.selected.size} 条`;
  el('transfer-preview').disabled = state.selected.size === 0;
}

function transferTarget() {
  return el('transfer-unassign').checked ? '' : el('transfer-to').value.trim();
}

// 选定或目标一变，之前的预演结果就作废，避免照着过期的对照执行
function invalidatePreview() {
  state.preview = null;
  renderPreview();
}

async function runPreview() {
  clearNotice();
  clearFieldMarks();
  const depIds = Array.from(state.selected);
  if (!depIds.length) {
    notify('请先勾选要转交的登记', 'error');
    return;
  }
  const unassign = el('transfer-unassign').checked;
  const toOwner = transferTarget();
  if (!unassign && !toOwner) {
    notify('请填写新责任人，或者勾选撤掉责任人', 'error');
    markField('toOwner');
    return;
  }
  try {
    const result = await request('/api/transfers/preview', {
      method: 'POST',
      body: JSON.stringify({ depIds, toOwner }),
    });
    state.preview = { depIds, toOwner, result };
    renderPreview();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

// 预演结果：会改动哪些登记、前后条数对照，确认之后才真的执行
function renderPreview() {
  const box = el('transfer-preview-box');
  if (!state.preview) {
    box.className = 'transfer-preview hidden';
    box.innerHTML = '';
    return;
  }
  const { toOwner, result } = state.preview;
  const target = toOwner ? `转给 ${escapeHtml(toOwner)}` : '撤掉责任人（回到未指定一组）';
  let html = `<h4>预演结果：${target}</h4>`;
  if (!result.changes.length) {
    html += '<p>选中的登记本来就是这个状态，没有需要改动的。</p>';
  } else {
    const extra = result.unchanged.length ? `，另有 ${result.unchanged.length} 条本来就是这个状态、不会改动` : '';
    html += `<p>将改动 ${result.changes.length} 条登记${extra}：</p>`;
    html += `<ul>${result.changes.map((change) => `<li>${escapeHtml(change.projectName)} / <span class="mono">${escapeHtml(change.name)}</span>：${escapeHtml(ownerText(change.fromOwner))} → ${escapeHtml(ownerText(change.toOwner))}</li>`).join('')}</ul>`;
    html += `<p class="transfer-counts">条数对照：${result.counts.map((item) => `${escapeHtml(ownerText(item.owner))} ${item.before} → ${item.after}`).join('；')}</p>`;
    html += '<div class="form-actions"><button type="button" data-transfer-confirm>确认转交</button><button type="button" class="ghost" data-transfer-cancel>取消</button></div>';
    box.innerHTML = html;
    box.className = 'transfer-preview';
    return;
  }
  html += '<div class="form-actions"><button type="button" class="ghost" data-transfer-cancel>知道了</button></div>';
  box.innerHTML = html;
  box.className = 'transfer-preview';
}

async function runTransfer() {
  if (!state.preview) return;
  clearNotice();
  clearFieldMarks();
  const { depIds, toOwner } = state.preview;
  try {
    const payload = await request('/api/transfers', {
      method: 'POST',
      body: JSON.stringify({ depIds, toOwner, operator: currentOperator() }),
    });
    const countsText = payload.counts.map((item) => `${ownerText(item.owner)} ${item.before}→${item.after}`).join('、');
    const moved = payload.transfer.items.length;
    notify(toOwner
      ? `已把 ${moved} 条登记转给 ${toOwner}（${countsText}）`
      : `已撤掉 ${moved} 条登记的责任人，回到未指定一组（${countsText}）`, 'ok');
    state.selected.clear();
    state.preview = null;
    el('transfer-to').value = '';
    el('transfer-unassign').checked = false;
    el('transfer-to').disabled = false;
    renderPreview();
    await Promise.all([loadOwners(), loadTransfers(), loadDeps()]);
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
    invalidatePreview();
  }
}

// 转交记录：什么时候、由谁、转给了谁，展开能看到每一条登记原来的责任人
function renderTransfers() {
  const body = el('transfer-body');
  body.innerHTML = state.transfers.map((record) => {
    const expanded = state.expandedTransfers.has(record.id);
    const toLabel = record.toOwner ? escapeHtml(record.toOwner) : '<span class="missing">未指定（撤掉责任人）</span>';
    let html = `<tr>
      <td class="mono">${escapeHtml(formatTime(record.at))}</td>
      <td>${record.operator ? escapeHtml(record.operator) : '<span class="missing">未留名</span>'}</td>
      <td>${toLabel}</td>
      <td>${record.items.length} 条</td>
      <td><button type="button" class="link" data-transfer-toggle="${escapeHtml(record.id)}">${expanded ? '收起 ▴' : '展开 ▾'}</button></td>
    </tr>`;
    if (expanded) {
      const items = record.items.map((item) => `<li>${escapeHtml(item.projectName)} / <span class="mono">${escapeHtml(item.name)}</span>：${escapeHtml(ownerText(item.fromOwner))} → ${escapeHtml(ownerText(record.toOwner))}</li>`).join('');
      html += `<tr class="transfer-detail"><td colspan="5"><ul class="transfer-items">${items}</ul></td></tr>`;
    }
    return html;
  }).join('');
  el('transfer-empty').classList.toggle('hidden', state.transfers.length > 0);
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
    await Promise.all([loadDeps(), loadOwners()]);
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
    await loadProjects();
    await Promise.all([loadDeps(), loadOwners()]);
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

// 列表上的操作用事件委托统一处理，列表重绘之后不需要重新绑定
document.addEventListener('click', async (event) => {
  const node = event.target.closest('button');
  if (!node) return;

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
      await Promise.all([loadDeps(), loadOwners()]);
    } catch (err) {
      notify(err.message, 'error');
    }
    return;
  }

  // 责任人分组的展开与收起，空串是未指定那一组
  if (node.dataset.ownerToggle !== undefined) {
    const owner = node.dataset.ownerToggle;
    if (state.expandedOwners.has(owner)) state.expandedOwners.delete(owner);
    else state.expandedOwners.add(owner);
    renderOwners();
    return;
  }

  if (node.dataset.transferToggle) {
    const id = node.dataset.transferToggle;
    if (state.expandedTransfers.has(id)) state.expandedTransfers.delete(id);
    else state.expandedTransfers.add(id);
    renderTransfers();
    return;
  }

  if (node.dataset.transferConfirm !== undefined) {
    runTransfer();
    return;
  }

  if (node.dataset.transferCancel !== undefined) {
    invalidatePreview();
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
      await loadProjects();
      await Promise.all([loadDeps(), loadOwners()]);
    } catch (err) {
      notify(err.message, 'error');
    }
  }
});

// 勾选登记、全选某一组、撤掉责任人开关，这些勾选框统一走 change 事件
document.addEventListener('change', (event) => {
  const node = event.target;

  if (node.matches('[data-transfer-pick]')) {
    if (node.checked) state.selected.add(node.dataset.transferPick);
    else state.selected.delete(node.dataset.transferPick);
    updateTransferCount();
    invalidatePreview();
    return;
  }

  if (node.matches('[data-owner-select-all]')) {
    const group = ownerGroup(node.dataset.ownerSelectAll);
    group.deps.forEach((dep) => {
      if (node.checked) state.selected.add(dep.id);
      else state.selected.delete(dep.id);
    });
    renderOwners();
    invalidatePreview();
    return;
  }

  if (node.id === 'transfer-unassign') {
    el('transfer-to').disabled = node.checked;
    if (node.checked) el('transfer-to').value = '';
    invalidatePreview();
  }
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
    .then(() => Promise.all([loadDeps(), loadOwners(), loadTransfers()]))
    .catch((err) => notify(err.message, 'error'));
});
el('transfer-preview').addEventListener('click', runPreview);
el('transfer-to').addEventListener('input', invalidatePreview);
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

// 页面打开时先把项目、依赖登记、责任人分组与转交记录都拉一遍，项目决定登记表单里能选哪些归属
restoreOperator();
loadHealth();
loadProjects()
  .then(() => Promise.all([loadDeps(), loadOwners(), loadTransfers()]))
  .catch((err) => notify(err.message, 'error'));
