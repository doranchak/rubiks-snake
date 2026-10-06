const CATEGORY_LABELS = {
  all: 'All',
  easy: 'Easy',
  hard: 'Hard',
  manuals: 'Manuals',
  fansfriends: 'Fans & Friends',
};

export async function loadCatalog() {
  const res = await fetch('data/figures.json');
  if (!res.ok) throw new Error(`Failed to load figures.json: ${res.status}`);
  const data = await res.json();

  const flat = [];
  Object.entries(data.figures).forEach(([cat, figs]) => {
    figs.forEach((fg) => flat.push({ ...fg, category: cat }));
  });

  return { byCategory: data.figures, flat, categories: data.categories };
}

export class CatalogUI {
  constructor({ tabsEl, gridEl, searchEl, onSelect }) {
    this.tabsEl = tabsEl;
    this.gridEl = gridEl;
    this.searchEl = searchEl;
    this.onSelect = onSelect;
    this.activeCategory = 'all';
    this.query = '';
    this.catalog = null;
    this.selectedId = null;

    this.searchEl.addEventListener('input', () => {
      this.query = this.searchEl.value.trim().toLowerCase();
      this.render();
    });
  }

  async init(catalog) {
    this.catalog = catalog;
    const cats = ['all', ...catalog.categories.map((c) => c.key)];
    this.tabsEl.innerHTML = '';
    cats.forEach((key) => {
      const count = key === 'all' ? catalog.flat.length : catalog.byCategory[key].length;
      const btn = document.createElement('button');
      btn.className = 'category-tab' + (key === this.activeCategory ? ' active' : '');
      btn.textContent = `${CATEGORY_LABELS[key] || key} (${count})`;
      btn.dataset.key = key;
      btn.addEventListener('click', () => {
        this.activeCategory = key;
        [...this.tabsEl.children].forEach((c) => c.classList.toggle('active', c === btn));
        this.render();
      });
      this.tabsEl.appendChild(btn);
    });
    this.render();
  }

  currentList() {
    const base = this.activeCategory === 'all' ? this.catalog.flat : this.catalog.byCategory[this.activeCategory];
    if (!this.query) return base;
    return base.filter((fg) => fg.title.toLowerCase().includes(this.query));
  }

  setSelected(id) {
    this.selectedId = id;
    [...this.gridEl.children].forEach((el) => {
      el.classList.toggle('selected', el.dataset.id === id);
    });
  }

  render() {
    const list = this.currentList();
    this.gridEl.innerHTML = '';
    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'catalog-empty';
      empty.textContent = 'No figures match your search.';
      this.gridEl.appendChild(empty);
      return;
    }
    list.forEach((fg) => {
      const item = document.createElement('div');
      item.className = 'catalog-item' + (fg.id === this.selectedId ? ' selected' : '');
      item.dataset.id = fg.id;
      item.innerHTML = `
        <img src="${fg.img}" alt="${fg.title}" loading="lazy">
        <div class="cat-title">${fg.title}</div>
      `;
      item.addEventListener('click', () => {
        this.setSelected(fg.id);
        this.onSelect(fg);
      });
      this.gridEl.appendChild(item);
    });
  }
}
