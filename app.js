// Вспомогательная функция: форматирование даты в локальном формате YYYY-MM-DD
// (вместо toISOString(), которая использует UTC и даёт смещение)
function formatDateLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const DB = {
  dbName: 'HabitTracker_DB',
  version: 2,
  db: null,

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('habits')) {
          db.createObjectStore('habits', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('completions')) {
          const store = db.createObjectStore('completions', { keyPath: 'id', autoIncrement: true });
          store.createIndex('habitId_date', ['habitId', 'date'], { unique: true });
          store.createIndex('habitId', 'habitId', { unique: false });
        }
      };
      request.onsuccess = (e) => { this.db = e.target.result; resolve(this.db); };
      request.onerror = (e) => reject(e.target.error);
    });
  },

  async addHabit(name, goal, icon) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('habits', 'readwrite');
      const request = tx.objectStore('habits').add({ 
        name, goal, icon, 
        createdAt: new Date().toISOString() 
      });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async updateHabit(id, name, goal, icon) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('habits', 'readwrite');
      const store = tx.objectStore('habits');
      const getRequest = store.get(id);
      getRequest.onsuccess = () => {
        const habit = getRequest.result;
        habit.name = name;
        habit.goal = goal;
        habit.icon = icon;
        store.put(habit).onsuccess = () => resolve();
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  },

  async deleteHabit(id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['habits', 'completions'], 'readwrite');
      tx.objectStore('habits').delete(id);
      const compStore = tx.objectStore('completions');
      const index = compStore.index('habitId');
      const request = index.getAll(id);
      request.onsuccess = () => {
        request.result.forEach(comp => compStore.delete(comp.id));
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async getHabits() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('habits', 'readonly');
      const request = tx.objectStore('habits').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async toggleCompletion(habitId, date) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('completions', 'readwrite');
      const store = tx.objectStore('completions');
      const index = store.index('habitId_date');
      const request = index.get([habitId, date]);
      request.onsuccess = () => {
        if (request.result) {
          store.delete(request.result.id).onsuccess = () => resolve(false);
        } else {
          store.add({ habitId, date }).onsuccess = () => resolve(true);
        }
      };
      request.onerror = () => reject(request.error);
    });
  },

  async getCompletionsByMonth(habitId, year, month) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('completions', 'readonly');
      const store = tx.objectStore('completions');
      const index = store.index('habitId');
      const request = index.getAll(habitId);
      request.onsuccess = () => {
        const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
        resolve(request.result.filter(c => c.date.startsWith(prefix)));
      };
      request.onerror = () => reject(request.error);
    });
  },

  async getCompletionsByWeek(habitId, startDate, endDate) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('completions', 'readonly');
      const store = tx.objectStore('completions');
      const index = store.index('habitId');
      const request = index.getAll(habitId);
      request.onsuccess = () => {
        const startStr = formatDateLocal(startDate);
        const endStr = formatDateLocal(endDate);
        resolve(request.result.filter(c => c.date >= startStr && c.date <= endStr));
      };
      request.onerror = () => reject(request.error);
    });
  }
};

const State = {
  currentWeekStart: null,
  theme: localStorage.getItem('pwa_theme') || 'theme-dark',
  contextHabitId: null,

  init() {
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    this.currentWeekStart = new Date(today.setDate(diff));
    this.currentWeekStart.setHours(0, 0, 0, 0);
    this.applyTheme();
  },

  applyTheme() {
    document.body.className = this.theme;
    localStorage.setItem('pwa_theme', this.theme);
    const colors = { 'theme-light': '#f5f5f5', 'theme-dark': '#1c1b1f', 'theme-amoled': '#000000' };
    document.getElementById('theme-color-meta').setAttribute('content', colors[this.theme]);
  },

  cycleTheme() {
    const themes = ['theme-light', 'theme-dark', 'theme-amoled'];
    const idx = themes.indexOf(this.theme);
    this.theme = themes[(idx + 1) % themes.length];
    this.applyTheme();
  },

  getNextWeek() {
    const next = new Date(this.currentWeekStart);
    next.setDate(next.getDate() + 7);
    this.currentWeekStart = next;
  },

  getPrevWeek() {
    const prev = new Date(this.currentWeekStart);
    prev.setDate(prev.getDate() - 7);
    this.currentWeekStart = prev;
  },

  getWeekDays() {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(this.currentWeekStart);
      day.setDate(day.getDate() + i);
      days.push(day);
    }
    return days;
  }
};

const UI = {
  views: {
    grid: document.getElementById('view-grid'),
    stats: document.getElementById('view-stats')
  },

  showView(viewName) {
    Object.values(this.views).forEach(v => v.classList.remove('active'));
    this.views[viewName].classList.add('active');
  },

  async renderGrid() {
    const container = document.getElementById('habits-list');
    const label = document.getElementById('current-week-label');
    const habits = await DB.getHabits();
    const weekDays = State.getWeekDays();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Заголовок недели с годом
    const options = { day: 'numeric', month: 'short' };
    const year = weekDays[0].getFullYear();
    label.textContent = `${weekDays[0].toLocaleDateString('ru-RU', options)} - ${weekDays[6].toLocaleDateString('ru-RU', options)} ${year}`;

    if (habits.length === 0) {
      container.innerHTML = '<div class="empty-state">Нет привычек.<br>Нажмите + для добавления</div>';
      document.getElementById('month-stats-summary').innerHTML = '';
      return;
    }

    const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();

    let html = '';
    for (const habit of habits) {
      const weekCompletions = await DB.getCompletionsByWeek(habit.id, weekDays[0], weekDays[6]);
      const monthCompletions = await DB.getCompletionsByMonth(habit.id, currentYear, currentMonth);
      const completedDates = new Set(weekCompletions.map(c => c.date));
      const monthCount = monthCompletions.length;
      const progress = Math.min(100, Math.round((monthCount / habit.goal) * 100));

      html += `<div class="habit-card" data-id="${habit.id}">
        <div class="habit-card-header">
          <div class="habit-card-title">
            <span class="habit-icon">${habit.icon}</span>
            <span class="habit-name">${this.escapeHtml(habit.name)}</span>
          </div>
          <button class="habit-menu-btn" data-id="${habit.id}" aria-label="Меню">⋮</button>
        </div>
        <div class="habit-days">`;

      weekDays.forEach((day, i) => {
        const dateStr = formatDateLocal(day);
        const isCompleted = completedDates.has(dateStr);
        const isToday = day.getTime() === today.getTime();
        const isFuture = day > today;
        
        html += `<button class="day-cell ${isCompleted ? 'completed' : ''} ${isToday ? 'today' : ''} ${isFuture ? 'future' : ''}" 
          data-habit="${habit.id}" data-date="${dateStr}">
          <span class="day-name">${dayNames[i]}</span>
          <span class="day-num">${day.getDate()}</span>
        </button>`;
      });

      // data-атрибуты для быстрого обновления без полной перерисовки
      html += `</div>
        <div class="habit-progress">
          <span class="habit-progress-text" data-habit-month="${habit.id}">${monthCount}/${habit.goal} в этом месяце</span>
          <div class="habit-progress-bar">
            <div class="habit-progress-fill" data-habit-progress="${habit.id}" style="width: ${progress}%"></div>
          </div>
        </div>
      </div>`;
    }

    container.innerHTML = html;

    // Обработчики кликов по дням
    container.querySelectorAll('.day-cell:not(.future)').forEach(cell => {
      cell.addEventListener('click', async () => {
        const habitId = parseInt(cell.dataset.habit, 10);
        const date = cell.dataset.date;
        const isCompleted = await DB.toggleCompletion(habitId, date);
        cell.classList.toggle('completed', isCompleted);
        
        // Мгновенное обновление счётчика и прогресс-бара
        await this.updateHabitMonthStats(habitId);
        await this.renderMonthSummary();
      });
    });

    // Обработчики меню
    container.querySelectorAll('.habit-menu-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showContextMenu(parseInt(btn.dataset.id, 10), btn);
      });
    });

    await this.renderMonthSummary();
  },

  // Быстрое обновление статистики конкретной привычки без полной перерисовки
  async updateHabitMonthStats(habitId) {
    const habits = await DB.getHabits();
    const habit = habits.find(h => h.id === habitId);
    if (!habit) return;
    
    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    const monthCompletions = await DB.getCompletionsByMonth(habit.id, currentYear, currentMonth);
    const monthCount = monthCompletions.length;
    const progress = Math.min(100, Math.round((monthCount / habit.goal) * 100));
    
    const progressText = document.querySelector(`[data-habit-month="${habitId}"]`);
    if (progressText) {
      progressText.textContent = `${monthCount}/${habit.goal} в этом месяце`;
    }
    
    const progressBar = document.querySelector(`[data-habit-progress="${habitId}"]`);
    if (progressBar) {
      progressBar.style.width = `${progress}%`;
    }
  },

  async renderMonthSummary() {
    const container = document.getElementById('month-stats-summary');
    const habits = await DB.getHabits();
    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();

    let totalCompleted = 0;
    let totalGoal = 0;
    let completedHabits = 0;

    for (const habit of habits) {
      const completions = await DB.getCompletionsByMonth(habit.id, currentYear, currentMonth);
      totalCompleted += completions.length;
      totalGoal += habit.goal;
      if (completions.length >= habit.goal) completedHabits++;
    }

    const progress = totalGoal > 0 ? Math.round((totalCompleted / totalGoal) * 100) : 0;

    container.innerHTML = `
      <h3>📅 ${today.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}</h3>
      <div class="summary-grid">
        <div class="summary-item">
          <div class="value">${totalCompleted}</div>
          <div class="label">Выполнено</div>
        </div>
        <div class="summary-item">
          <div class="value">${totalGoal}</div>
          <div class="label">Цель</div>
        </div>
        <div class="summary-item">
          <div class="value">${progress}%</div>
          <div class="label">Прогресс</div>
        </div>
        <div class="summary-item">
          <div class="value">${completedHabits}/${habits.length}</div>
          <div class="label">Достигнуто</div>
        </div>
      </div>
    `;
  },

  showContextMenu(habitId, anchor) {
    State.contextHabitId = habitId;
    const menu = document.getElementById('context-menu');
    const rect = anchor.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${Math.max(8, rect.right - 160)}px`;
    menu.classList.remove('hidden');
    setTimeout(() => document.addEventListener('click', this.hideContextMenu, { once: true }), 0);
  },

  hideContextMenu() {
    document.getElementById('context-menu').classList.add('hidden');
  },

  openHabitDialog(habit = null) {
    const dialog = document.getElementById('dialog-habit');
    const title = document.getElementById('dialog-habit-title');
    const btnSave = document.getElementById('btn-save-habit');
    const inputId = document.getElementById('input-habit-id');
    const inputName = document.getElementById('input-habit-name');
    const inputGoal = document.getElementById('input-habit-goal');
    const inputIcon = document.getElementById('input-habit-icon');

    const defaultIcon = habit?.icon || '';
    document.querySelectorAll('.emoji-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.emoji === defaultIcon);
    });

    if (habit) {
      title.textContent = 'Редактировать привычку';
      btnSave.textContent = 'Сохранить';
      inputId.value = habit.id;
      inputName.value = habit.name;
      inputGoal.value = habit.goal;
      inputIcon.value = habit.icon;
    } else {
      title.textContent = 'Новая привычка';
      btnSave.textContent = 'Создать';
      inputId.value = '';
      inputName.value = '';
      inputGoal.value = '';
      inputIcon.value = '🧘';
    }
    dialog.showModal();
  },

  async renderStats() {
    const container = document.getElementById('stats-list');
    const habits = await DB.getHabits();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const todayDate = today.getDate();

    if (habits.length === 0) {
      container.innerHTML = '<div class="empty-state">Нет данных</div>';
      this.showView('stats');
      return;
    }

    let html = '';
    for (const habit of habits) {
      const completions = await DB.getCompletionsByMonth(habit.id, currentYear, currentMonth);
      
      const completedDates = new Set();
      completions.forEach(c => {
        const parts = c.date.split('-');
        if (parts.length === 3) {
          const day = parseInt(parts[2], 10);
          if (!isNaN(day)) completedDates.add(day);
        }
      });
      
      const completed = completions.length;
      const progress = Math.min(100, Math.round((completed / habit.goal) * 100));

      // Подсчёт серии: идём от сегодня назад, пока дни выполнены
      let streak = 0;
      for (let d = todayDate; d >= 1; d--) {
        if (completedDates.has(d)) {
          streak++;
        } else {
          break;
        }
      }

      console.log(`📊 ${habit.name}:`, {
        'Сегодня': todayDate,
        'Выполненные дни': Array.from(completedDates).sort((a,b) => a-b),
        'Серия': streak
      });

      html += `<div class="stats-card">
        <div class="stats-card-header">
          <span class="icon">${habit.icon}</span>
          <span class="name">${this.escapeHtml(habit.name)}</span>
        </div>
        <div class="stats-grid">`;

      for (let d = 1; d <= daysInMonth; d++) {
        html += `<div class="stats-day ${completedDates.has(d) ? 'completed' : ''}">${d}</div>`;
      }

      html += `</div>
        <div class="stats-footer">
          <div class="stat">
            <div class="stat-value">${completed}/${habit.goal}</div>
            <div class="stat-label">Выполнено</div>
          </div>
          <div class="stat">
            <div class="stat-value">${streak}</div>
            <div class="stat-label">🔥 Серия</div>
          </div>
          <div class="stat">
            <div class="stat-value">${progress}%</div>
            <div class="stat-label">Прогресс</div>
          </div>
        </div>
      </div>`;
    }

    container.innerHTML = html;
    this.showView('stats');
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

// Инициализация
document.addEventListener('DOMContentLoaded', async () => {
  await DB.init();
  State.init();
  UI.showView('grid');
  await UI.renderGrid();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(console.error);
  }

  // Навигация по неделям
  document.getElementById('btn-prev-week').addEventListener('click', async () => {
    State.getPrevWeek();
    await UI.renderGrid();
  });

  document.getElementById('btn-next-week').addEventListener('click', async () => {
    State.getNextWeek();
    await UI.renderGrid();
  });

  // Свайпы
  let touchStartX = 0;
  const gridView = document.getElementById('view-grid');
  gridView.addEventListener('touchstart', (e) => { touchStartX = e.changedTouches[0].screenX; }, { passive: true });
  gridView.addEventListener('touchend', async (e) => {
    const diff = touchStartX - e.changedTouches[0].screenX;
    if (Math.abs(diff) > 50) {
      diff > 0 ? State.getNextWeek() : State.getPrevWeek();
      await UI.renderGrid();
    }
  }, { passive: true });

  // Смена темы
  document.getElementById('btn-theme').addEventListener('click', () => State.cycleTheme());

  // Эмодзи-пикер
  document.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.emoji-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      document.getElementById('input-habit-icon').value = btn.dataset.emoji;
    });
  });

  // Добавление привычки
  document.getElementById('btn-add-habit').addEventListener('click', () => UI.openHabitDialog());

  // Закрытие модалок
  document.querySelectorAll('.modal-cancel').forEach(btn => {
    btn.addEventListener('click', (e) => e.target.closest('dialog').close());
  });

  // Сохранение привычки (создание/редактирование)
  document.getElementById('form-habit').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('input-habit-id').value;
    const name = document.getElementById('input-habit-name').value.trim();
    const goal = parseInt(document.getElementById('input-habit-goal').value, 10);
    const icon = document.getElementById('input-habit-icon').value;

    if (name && goal) {
      if (id) {
        await DB.updateHabit(parseInt(id, 10), name, goal, icon);
      } else {
        await DB.addHabit(name, goal, icon);
      }
      document.getElementById('dialog-habit').close();
      await UI.renderGrid();
    }
  });

  // Контекстное меню: Редактировать
  document.getElementById('ctx-edit').addEventListener('click', async () => {
    const habits = await DB.getHabits();
    const habit = habits.find(h => h.id === State.contextHabitId);
    if (habit) UI.openHabitDialog(habit);
    UI.hideContextMenu();
  });

  // Контекстное меню: Удалить
  document.getElementById('ctx-delete').addEventListener('click', async () => {
    if (confirm('Удалить привычку и все отметки?')) {
      await DB.deleteHabit(State.contextHabitId);
      await UI.renderGrid();
    }
    UI.hideContextMenu();
  });

  // Переход к статистике
  document.getElementById('btn-view-stats').addEventListener('click', () => UI.renderStats());
  document.getElementById('btn-back-stats').addEventListener('click', () => UI.showView('grid'));
});