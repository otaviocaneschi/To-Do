(() => {
  const API = {
    list: () => fetch('/api/tasks'),
    create: (payload) => fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }),
    update: (id, payload) => fetch(`/api/tasks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }),
    toggle: (id) => fetch(`/api/tasks/${id}/toggle`, { method: 'PATCH' }),
    remove: (id) => fetch(`/api/tasks/${id}`, { method: 'DELETE' }),
  };

  const els = {
    form: document.getElementById('taskForm'),
    text: document.getElementById('taskText'),
    priority: document.getElementById('taskPriority'),
    list: document.getElementById('taskList'),
    empty: document.getElementById('emptyState'),
    refresh: document.getElementById('refreshBtn'),
    charCount: document.getElementById('charCount'),
    charMax: document.getElementById('charMax'),
    toastArea: document.getElementById('toastArea'),

    editModalEl: document.getElementById('editModal'),
    editForm: document.getElementById('editForm'),
    editId: document.getElementById('editId'),
    editText: document.getElementById('editText'),
    editPriority: document.getElementById('editPriority'),
  };

  // Guard: se IDs do HTML não baterem, para e avisa.
  if (!els.form || !els.text || !els.list) {
    console.error("IDs do HTML não batem com o app.js. Verifique taskForm/taskText/taskList.");
    return;
  }

  // Bootstrap Modal (precisa do bootstrap.bundle.js carregado)
  const editModal = els.editModalEl ? new bootstrap.Modal(els.editModalEl) : null;

  let tasks = [];
  let filter = 'all';

  // ---------- Helpers ----------
  const normalizeText = (s) => (s || '').trim().replace(/\s+/g, ' ');

  const escapeHtml = (str) => {
    return String(str).replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[m]));
  };

  const showToast = (message, type = 'success') => {
    if (!els.toastArea) return alert(message);

    const colors = {
      success: 'text-bg-success',
      danger: 'text-bg-danger',
      warning: 'text-bg-warning',
      info: 'text-bg-info',
    };

    const toast = document.createElement('div');
    toast.className = `toast align-items-center ${colors[type] || colors.info} border-0`;
    toast.role = 'status';
    toast.ariaLive = 'polite';
    toast.ariaAtomic = 'true';

    toast.innerHTML = `
      <div class="d-flex">
        <div class="toast-body">${escapeHtml(message)}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Fechar"></button>
      </div>
    `;

    els.toastArea.appendChild(toast);
    const bsToast = new bootstrap.Toast(toast, { delay: 2500 });
    bsToast.show();
    toast.addEventListener('hidden.bs.toast', () => toast.remove());
  };

  const formatDate = (iso) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return '';
    }
  };

  const priorityLabel = (p) => {
    if (p === 'high') return { text: 'Alta', cls: 'badge-high' };
    if (p === 'low') return { text: 'Baixa', cls: 'badge-low' };
    return { text: 'Média', cls: 'badge-medium' };
  };

  // ---------- Render ----------
  const applyFilter = (items) => {
    if (filter === 'pending') return items.filter(t => !t.completed);
    if (filter === 'completed') return items.filter(t => t.completed);
    return items;
  };

  const render = () => {
    const shown = applyFilter(tasks);

    els.list.innerHTML = '';
    if (els.empty) els.empty.classList.toggle('d-none', shown.length !== 0);

    shown.forEach(task => {
      const p = priorityLabel(task.priority);

      const item = document.createElement('div');
      item.className = 'task-item fade-in';

      item.innerHTML = `
        <div class="d-flex align-items-start justify-content-between gap-3">
          <div class="flex-grow-1">
            <div class="d-flex align-items-center gap-2">
              <span class="badge badge-priority ${p.cls}">${p.text}</span>
              <p class="task-title ${task.completed ? 'completed' : ''}">
                ${escapeHtml(task.text)}
              </p>
            </div>
            <div class="task-meta mt-1">
              <i class="bi bi-clock me-1"></i>
              Criada em ${formatDate(task.created_at)}
            </div>
          </div>

          <div class="btn-group flex-shrink-0">
            <button class="btn btn-outline-success icon-btn"
                    data-action="toggle" data-id="${task.id}"
                    title="${task.completed ? 'Reabrir' : 'Concluir'}">
            </button>
            <button class="btn btn-outline-info icon-btn"
                    data-action="edit" data-id="${task.id}"
                    title="Editar">
            </button>
            <button class="btn btn-outline-danger icon-btn"
                    data-action="delete" data-id="${task.id}"
                    title="Excluir">
            </button>
          </div>
        </div>
      `;

      item.addEventListener('click', async (ev) => {
        const action = ev.target.closest('button')?.dataset.action;
        if (!action) return;

        const tid = task.id;
        if (action === 'toggle') await toggle(tid);
        if (action === 'edit') await edit(tid);
        if (action === 'delete') await del(tid);
      });

      els.list.appendChild(item);
    });
  };

  // ---------- Load ----------
  const load = async () => {
    try {
      const res = await API.list();
      const data = await res.json();

      if (!res.ok || !data.ok) {
        showToast(data.message || 'Erro ao carregar tarefas.', 'danger');
        return;
      }

      tasks = data.tasks || [];
      render();
    } catch (e) {
      console.error(e);
      showToast('Não foi possível carregar as tarefas. Verifique o servidor/JSON.', 'danger');
    }
  };

  // ---------- Events ----------
  // Filtros
  document.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filter = btn.dataset.filter;
      render();
    });
  });

  // Refresh
  if (els.refresh) els.refresh.addEventListener('click', load);

  // Contador de caracteres (se existir)
  const updateCounter = () => {
    if (!els.charCount || !els.charMax) return;
    els.charCount.textContent = els.text.value.length;
    els.charMax.textContent = els.text.maxLength || 100;
  };
  els.text.addEventListener('input', updateCounter);
  updateCounter();

  // Criar tarefa
  els.form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const text = normalizeText(els.text.value);

    if (!text || text.length > 100) {
      els.text.classList.add('is-invalid');
      showToast('Digite uma descrição válida (1 a 100 caracteres).', 'warning');
      return;
    }

    // Evita duplicação no cliente (backend também valida)
    const duplicate = tasks.some(t => t.text.trim().toLowerCase() === text.toLowerCase());
    if (duplicate) {
      els.text.classList.add('is-invalid');
      showToast('Essa tarefa já existe (duplicada).', 'warning');
      return;
    }

    els.text.classList.remove('is-invalid');

    try {
      const res = await API.create({ text, priority: els.priority.value });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        showToast(data.message || 'Erro ao adicionar tarefa.', 'danger');
        return;
      }

      tasks.unshift(data.task);
      els.text.value = '';
      updateCounter();
      showToast(data.message, 'success');
      render();
    } catch (e) {
      console.error(e);
      showToast('Falha de rede ao adicionar tarefa.', 'danger');
    }
  });

  // Delegação de clique: toggle/edit/delete
  els.list.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const id = btn.dataset.id;

    const task = tasks.find(t => t.id === id);
    if (!task) return showToast('Tarefa não encontrada.', 'danger');

    try {
      if (action === 'toggle') {
        const res = await API.toggle(id);
        const data = await res.json();
        if (!res.ok || !data.ok) return showToast(data.message || 'Erro ao atualizar.', 'danger');

        tasks = tasks.map(t => t.id === id ? data.task : t);
        showToast(data.message, 'success');
        render();
      }

      if (action === 'edit') {
        if (!editModal) {
          showToast('Modal não carregou. Verifique Bootstrap JS.', 'danger');
          return;
        }
        els.editId.value = task.id;
        els.editText.value = task.text;
        els.editPriority.value = task.priority || 'medium';
        els.editText.classList.remove('is-invalid');
        editModal.show();
      }

      if (action === 'delete') {
        const ok = confirm(`Tem certeza que deseja excluir?\n\n"${task.text}"`);
        if (!ok) return;

        const res = await API.remove(id);
        const data = await res.json();
        if (!res.ok || !data.ok) return showToast(data.message || 'Erro ao remover.', 'danger');

        tasks = tasks.filter(t => t.id !== id);
        showToast(data.message, 'success');
        render();
      }
    } catch (e) {
      console.error(e);
      showToast('Falha de rede ao executar ação.', 'danger');
    }
  });

  // Editar (modal)
  if (els.editForm) {
    els.editForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();

      const id = els.editId.value;
      const newText = normalizeText(els.editText.value);
      const priority = els.editPriority.value;

      if (!newText || newText.length > 100) {
        els.editText.classList.add('is-invalid');
        showToast('Digite uma descrição válida (1 a 100).', 'warning');
        return;
      }

      // Evita duplicação (exclui o próprio ID)
      const duplicate = tasks.some(t => t.id !== id && t.text.trim().toLowerCase() === newText.toLowerCase());
      if (duplicate) {
        els.editText.classList.add('is-invalid');
        showToast('Essa tarefa já existe (duplicada).', 'warning');
        return;
      }

      els.editText.classList.remove('is-invalid');

      try {
        const res = await API.update(id, { text: newText, priority });
        const data = await res.json();
        if (!res.ok || !data.ok) return showToast(data.message || 'Erro ao editar.', 'danger');

        tasks = tasks.map(t => t.id === id ? data.task : t);
        showToast(data.message, 'success');
        editModal?.hide();
        render();
      } catch (e) {
        console.error(e);
        showToast('Falha de rede ao editar tarefa.', 'danger');
      }
    });
  }

  // Init
  load();
})();