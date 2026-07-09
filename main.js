const obsidian = require('obsidian');

// ============================================================
// Settings Tab
// ============================================================
class QuestionBankSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Configurações do Banco de Questões' });
        new obsidian.Setting(containerEl)
            .setName('Caminho Base')
            .setDesc('Diretório inicial (ex: Exercicios)')
            .addText(text => text.setPlaceholder('Exercicios').setValue(this.plugin.settings.basePath)
                .onChange(async (value) => { this.plugin.settings.basePath = value; await this.plugin.saveSettings(); }));
    }
}

// ============================================================
// File Suggest Modal
// ============================================================
class FileSuggestModal extends obsidian.FuzzySuggestModal {
    constructor(app, onChooseCallback) { super(app); this.onChooseCallback = onChooseCallback; this.setPlaceholder("Pesquisar notas..."); }
    getItems() { return this.app.vault.getMarkdownFiles(); }
    getItemText(file) { return file.path; }
    onChooseItem(file, evt) { this.onChooseCallback(file); }
}

// ============================================================
// MultiSelectSearch (filtros)
// ============================================================
class MultiSelectSearch {
    constructor(parent, label, onChangeCallback) {
        this.container = parent.createDiv({ cls: "qb-filter-item qb-custom-multiselect" });
        this.container.createEl("label", { text: label });
        this.searchInput = this.container.createEl("input", { type: "text", placeholder: "Pesquisar...", cls: "qb-search-input" });
        this.listContainer = this.container.createDiv({ cls: "qb-options-list" });
        this.options = []; this.selected = new Set(['any']); this.onChange = onChangeCallback;
        this.searchInput.addEventListener("input", () => this.renderList());
    }
    updateOptions(newOptions) {
        this.options = newOptions; let newSelected = new Set();
        if (this.selected.has('any')) { newSelected.add('any'); } 
        else {
            for (let s of this.selected) { if (this.options.includes(s)) newSelected.add(s); }
            if (newSelected.size === 0) newSelected.add('any');
        }
        this.selected = newSelected; this.renderList();
    }
    getValues() { return Array.from(this.selected).filter(v => v !== 'any'); }
    renderList() {
        this.listContainer.empty();
        const query = this.searchInput.value.toLowerCase();
        let items = this.options.map(opt => ({ value: opt, label: opt }));
        items.sort((a, b) => {
            const aSel = this.selected.has(a.value); const bSel = this.selected.has(b.value);
            if (aSel && !bSel) return -1; if (!aSel && bSel) return 1;
            return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
        });
        items.unshift({ value: 'any', label: 'Qualquer' });
        items.forEach(item => {
            if (query && !item.label.toLowerCase().includes(query)) return;
            const isSelected = this.selected.has(item.value);
            const optEl = this.listContainer.createDiv({ cls: "qb-option" + (isSelected ? " is-selected" : "") });
            const cb = optEl.createEl("input", { type: "checkbox" });
            cb.checked = isSelected; cb.style.pointerEvents = "none";
            optEl.createEl("span", { text: item.label });
            optEl.onclick = () => this.handleSelect(item.value);
        });
    }
    handleSelect(val) {
        if (val === 'any') {
            if (!this.selected.has('any')) { this.selected.clear(); this.selected.add('any'); }
        } else {
            if (this.selected.has('any')) this.selected.delete('any');
            if (this.selected.has(val)) { if (this.selected.size > 1) this.selected.delete(val); } 
            else { this.selected.add(val); }
        }
        this.renderList(); if (this.onChange) this.onChange();
    }
}

// ============================================================
// Modal para definir tempo da prova
// ============================================================
class ExamTimeModal extends obsidian.Modal {
    constructor(app, onSubmit) {
        super(app);
        this.onSubmit = onSubmit;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h3', { text: 'Iniciar Prova' });
        const inputWrapper = contentEl.createDiv({ cls: 'qb-modal-input-row' });
        inputWrapper.createEl('label', { text: 'Tempo (minutos): ' });
        const input = inputWrapper.createEl('input', { type: 'number', value: '60', attr: { min: '1' } });
        const btn = contentEl.createEl('button', { text: 'Começar', cls: 'mod-cta' });
        btn.onclick = () => {
            const minutes = parseInt(input.value);
            if (minutes && minutes > 0) {
                this.close();
                this.onSubmit(minutes);
            } else {
                new obsidian.Notice('Informe um valor válido.');
            }
        };
    }
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// ============================================================
// Modal para nomear a prova antes de gerar
// ============================================================
class NameExamModal extends obsidian.Modal {
    constructor(app, onSubmit) {
        super(app);
        this.onSubmit = onSubmit;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h3', { text: 'Nova Prova' });
        const inputWrapper = contentEl.createDiv({ cls: 'qb-modal-input-row' });
        inputWrapper.createEl('label', { text: 'Nome da prova: ' });
        const defaultName = `Prova_${new Date().toISOString().replace(/[-:T]/g, '').slice(0,15)}`;
        const input = inputWrapper.createEl('input', { type: 'text', value: defaultName, placeholder: 'Nome do arquivo' });
        const btn = contentEl.createEl('button', { text: 'Criar Prova', cls: 'mod-cta' });
        btn.onclick = () => {
            const name = input.value.trim();
            if (name) {
                this.close();
                this.onSubmit(name);
            } else {
                new obsidian.Notice('Informe um nome válido.');
            }
        };
    }
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// ============================================================
// QuestionBankView (com abas)
// ============================================================
class QuestionBankView extends obsidian.ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.resetState();
        this.filters = { diff: 'any', fontes: [], areas: [], subareas: [], topicos: [], useUtility: false, useRelUtility: false, maxQuestions: 0 };
        this.currentTab = "livre";
        this.activeExam = null;
        this.examSearchQuery = "";
    }
    
    resetState() {
        this.currentQuestions = []; this.currentIndex = 0; this.actionHistory = [];
        this.isRendering = false; this.isGenerating = false; this.allQuestionsMetadata = [];
    }

    getViewType() { return "question-bank-view"; }
    getDisplayText() { return "Banco de Questões"; }
    
    async onOpen() {
        this.containerEl.children[1].empty();
        this.mainContent = this.containerEl.children[1].createDiv({ cls: "qb-main-container" });
        this.renderTabs();
        this.contentArea = this.mainContent.createDiv({ cls: "qb-tab-content" });
        await this.loadTabContent();
    }

    renderTabs() {
        const tabsDiv = this.mainContent.createDiv({ cls: "qb-tabs" });
        const createTab = (id, label) => {
            const btn = tabsDiv.createEl("button", { text: label, cls: `qb-tab-btn ${this.currentTab === id ? 'active' : ''}` });
            btn.onclick = async () => { this.currentTab = id; Array.from(tabsDiv.children).forEach(c => c.removeClass('active')); btn.addClass('active'); await this.loadTabContent(); };
        };
        createTab("livre", "Modo Livre");
        createTab("provas", "Modo Prova");
        createTab("stats", "Estatísticas");
    }

    async loadTabContent() {
        this.contentArea.empty();
        try {
            if (this.currentTab === "livre") await this.renderModoLivre();
            else if (this.currentTab === "provas") await this.renderModoProva();
            else if (this.currentTab === "stats") await this.renderStats();
        } catch(e) {
            console.error(e);
            new obsidian.Notice("Erro ao carregar aba: " + e.message);
        }
    }

    // ---------------- METADADOS ----------------
    parseHierarchicalTag(tags) {
        if (!tags || !Array.isArray(tags)) return { area: "", subarea: "", topico: "", fullTag: "" };
        for (const tag of tags) {
            const parts = tag.split('/');
            if (parts.length === 3) {
                return { area: parts[0], subarea: parts[1], topico: parts[2], fullTag: tag };
            }
        }
        const parts = (tags[0] || "").split('/');
        return { area: parts[0] || "", subarea: parts[1] || "", topico: parts[2] || "", fullTag: tags[0] || "" };
    }

    // Extrai a fonte (primeira subpasta após o basePath)
    extractSource(filePath, basePath) {
        if (!basePath) return "Raiz";
        const normalizedBase = basePath.endsWith('/') ? basePath : basePath + '/';
        if (!filePath.startsWith(normalizedBase)) return "Raiz";
        const rel = filePath.substring(normalizedBase.length);
        const firstSlash = rel.indexOf('/');
        return firstSlash === -1 ? "Raiz" : rel.substring(0, firstSlash);
    }

    async extractMetadataTree() {
        const allFiles = this.app.vault.getMarkdownFiles();
        this.allQuestionsMetadata = [];
        const basePath = this.plugin.settings.basePath || "";
        allFiles.forEach(file => {
            if (basePath && !file.path.startsWith(basePath)) return;
            const cache = this.app.metadataCache.getFileCache(file);
            if (cache?.frontmatter && cache.frontmatter.tipo === 'exercícios') {
                let tags = cache.frontmatter.tags || [];
                if (typeof tags === 'string') tags = [tags];
                const { area, subarea, topico, fullTag } = this.parseHierarchicalTag(tags);
                const fonte = this.extractSource(file.path, basePath);
                this.allQuestionsMetadata.push({
                    file: file,
                    fonte: fonte,
                    area: area,
                    subarea: subarea,
                    topico: topico,
                    fullTag: fullTag,
                    dificuldade: parseInt(cache.frontmatter.dificuldade !== undefined ? cache.frontmatter.dificuldade : 5),
                    acertos: cache.frontmatter.acertos || 0,
                    erros: cache.frontmatter.erros || 0,
                    resolvido: cache.frontmatter.resolvido || 0
                });
            }
        });
    }

    // ---------------- AGREGAÇÃO DE RESULTADOS DE PROVAS (SOMENTE PARA UTILIDADE RELATIVA) ----------------
    async getExamPerformanceMap() {
        const map = new Map();
        const basePath = this.plugin.settings.basePath || "";
        const folderPath = basePath ? `${basePath}/provas` : "provas";
        try {
            const exists = await this.app.vault.adapter.exists(folderPath);
            if (!exists) return map;
        } catch(e) { return map; }
        const examFiles = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(folderPath));
        const allFiles = this.app.vault.getMarkdownFiles();

        for (const examFile of examFiles) {
            const cache = this.app.metadataCache.getFileCache(examFile);
            const fm = cache?.frontmatter;
            if (!fm?.tentativas || !Array.isArray(fm.tentativas)) continue;
            const content = await this.app.vault.read(examFile);
            const links = Array.from(content.matchAll(/!\[\[(.*?)\]\]/g)).map(m => m[1]);
            for (const tentativa of fm.tentativas) {
                if (!tentativa.answersDetail || !Array.isArray(tentativa.answersDetail)) continue;
                for (const detail of tentativa.answersDetail) {
                    if (!detail.q || !detail.r) continue;
                    const qFile = allFiles.find(f => f.basename === detail.q);
                    if (!qFile) continue;
                    const path = qFile.path;
                    if (!map.has(path)) map.set(path, { hits: 0, misses: 0 });
                    const per = map.get(path);
                    if (detail.r === 'hit') per.hits++;
                    else if (detail.r === 'miss') per.misses++;
                }
            }
        }
        return map;
    }

    // ---------------- CÁLCULOS DE UTILIDADE (SEPARADOS) ----------------
    computeEgoisticUtility(list) {
        list.forEach(q => {
            q.u_ego = Math.exp(1.1 * (q.erros || 0) - (q.acertos || 0));
        });
    }

    computeRelativeUtility(list, examPerfMap) {
        const stats = { 0: { hits: 0, misses: 0 }, 1: { hits: 0, misses: 0 }, 2: { hits: 0, misses: 0 }, 3: { hits: 0, misses: 0 }, 4: { hits: 0, misses: 0 }, 5: { hits: 0, misses: 0 } };
        for (const q of list) {
            const d = q.dificuldade;
            if (d < 0 || d > 5) continue;
            const perf = examPerfMap.get(q.file.path);
            if (perf) {
                stats[d].hits += perf.hits;
                stats[d].misses += perf.misses;
            }
        }
        const rates = {};
        for (let d = 0; d <= 5; d++) {
            const total = stats[d].hits + stats[d].misses;
            rates[d] = total > 0 ? stats[d].misses / total : 0.5;
        }
        list.forEach(q => {
            const d = q.dificuldade;
            const E = rates[d] || 0.5;
            q.u_rel = (E / (d + 1)) + (Math.pow(d, 2) * Math.pow(Math.max(0, E - 0.4), 3));
        });
    }

    // ---------------- FILTROS E UI BASE ----------------
    async buildFilterUI(container, mode = "livre") {
        const details = container.createEl("details", { cls: "qb-filter-details" });
        details.createEl("summary", { text: "Filtros e Configurações" });
        const filterPanel = details.createDiv({ cls: "qb-filter-panel" });
        await this.extractMetadataTree();

        const maxWrapper = filterPanel.createDiv({ cls: "qb-filter-item" });
        maxWrapper.createEl("label", { text: "Limite de Questões (0 = Infinito)" });
        this.uiMax = maxWrapper.createEl("input", { type: "number", value: String(this.filters.maxQuestions), attr: { min: "0" } });

        const diffWrapper = filterPanel.createDiv({ cls: "qb-filter-item" });
        diffWrapper.createEl("label", { text: "Nível de Dificuldade" });
        this.uiDiff = diffWrapper.createEl("select");
        this.uiDiff.createEl("option", { text: "Qualquer", value: "any" });
        ["0", "1", "2", "3", "4", "5"].forEach(d => this.uiDiff.createEl("option", { text: d, value: d }));
        this.uiDiff.value = this.filters.diff;

        // Filtro de fontes (pastas)
        this.fonteSelect = new MultiSelectSearch(filterPanel, "Fontes", null);
        
        this.areaSelect = new MultiSelectSearch(filterPanel, "Áreas", () => this.updateSubareasUI());
        this.subareaSelect = new MultiSelectSearch(filterPanel, "Subáreas", () => this.updateTopicosUI());
        this.topicoSelect = new MultiSelectSearch(filterPanel, "Tópicos", null);

        const utilWrapper1 = filterPanel.createDiv({ cls: "qb-filter-item-row" });
        this.uiUtilEgo = utilWrapper1.createEl("input", { type: "checkbox", attr: { id: "qb-field-util-ego" } });
        this.uiUtilEgo.checked = this.filters.useUtility;
        utilWrapper1.createEl("label", { text: "Priorizar: Utilidade Egoísta" }).setAttribute("for", "qb-field-util-ego");

        const utilWrapper2 = filterPanel.createDiv({ cls: "qb-filter-item-row" });
        this.uiUtilRel = utilWrapper2.createEl("input", { type: "checkbox", attr: { id: "qb-field-util-rel" } });
        this.uiUtilRel.checked = this.filters.useRelUtility;
        utilWrapper2.createEl("label", { text: "Priorizar: Utilidade Relativa" }).setAttribute("for", "qb-field-util-rel");

        // Atualizar opções de fontes e áreas
        this.updateFontesUI();
        this.updateAreasUI();

        if (mode === "livre") {
            const btn = container.createEl("button", { text: "Gerar Sequência Livre", cls: "qb-btn-generate" });
            btn.onclick = async () => {
                if (this.isGenerating) return;
                this.isGenerating = true;
                try {
                    this.updateFiltersFromUI();
                    await this.loadAndFilterQuestions();
                    await this.renderCurrentCard();
                } finally {
                    this.isGenerating = false;
                }
            };
        } else if (mode === "provas") {
            const btn = container.createEl("button", { text: "Gerar Arquivo de Prova", cls: "qb-btn-generate" });
            btn.onclick = async () => { 
                this.updateFiltersFromUI();
                await this.loadAndFilterQuestions();
                if (this.currentQuestions.length === 0) {
                    new obsidian.Notice("Nenhuma questão encontrada com os filtros.");
                    return;
                }
                new NameExamModal(this.app, (name) => {
                    this.generateExamFile(name);
                }).open();
            };
        } else if (mode === "stats") {
            const btn = container.createEl("button", { text: "Calcular Estatísticas", cls: "qb-btn-generate" });
            btn.onclick = async () => { 
                this.updateFiltersFromUI(); 
                await this.renderStatsPlots(); 
            };
        }
    }

    updateFontesUI() {
        const fontes = Array.from(new Set(this.allQuestionsMetadata.map(q => q.fonte).filter(Boolean))).sort();
        this.fonteSelect.updateOptions(fontes);
    }

    updateAreasUI() {
        const areas = Array.from(new Set(this.allQuestionsMetadata.map(q => q.area).filter(Boolean))).sort();
        this.areaSelect.updateOptions(areas);
        this.updateSubareasUI();
    }
    updateSubareasUI() {
        const selAreas = this.areaSelect.getValues();
        let f = selAreas.length > 0 ? this.allQuestionsMetadata.filter(q => selAreas.includes(q.area)) : this.allQuestionsMetadata;
        this.subareaSelect.updateOptions(Array.from(new Set(f.map(q => q.subarea).filter(Boolean))).sort());
        this.updateTopicosUI();
    }
    updateTopicosUI() {
        const selAreas = this.areaSelect.getValues();
        const selSubareas = this.subareaSelect.getValues();
        let f = this.allQuestionsMetadata;
        if (selAreas.length > 0) f = f.filter(q => selAreas.includes(q.area));
        if (selSubareas.length > 0) f = f.filter(q => selSubareas.includes(q.subarea));
        this.topicoSelect.updateOptions(Array.from(new Set(f.map(q => q.topico).filter(Boolean))).sort());
    }
    updateFiltersFromUI() {
        this.filters = {
            diff: this.uiDiff.value,
            fontes: this.fonteSelect.getValues(),
            areas: this.areaSelect.getValues(),
            subareas: this.subareaSelect.getValues(),
            topicos: this.topicoSelect.getValues(),
            useUtility: this.uiUtilEgo.checked,
            useRelUtility: this.uiUtilRel.checked,
            maxQuestions: parseInt(this.uiMax.value) || 0
        };
    }

    async loadAndFilterQuestions() {
        await this.extractMetadataTree();
        const examPerfMap = this.filters.useRelUtility ? await this.getExamPerformanceMap() : new Map();

        let filtered = this.allQuestionsMetadata.filter(q => {
            if (this.filters.diff !== 'any' && q.dificuldade !== parseInt(this.filters.diff)) return false;
            if (this.filters.fontes.length > 0 && !this.filters.fontes.includes(q.fonte)) return false;
            if (this.filters.areas.length > 0 && !this.filters.areas.includes(q.area)) return false;
            if (this.filters.subareas.length > 0 && !this.filters.subareas.includes(q.subarea)) return false;
            if (this.filters.topicos.length > 0 && !this.filters.topicos.includes(q.topico)) return false;
            return true;
        });

        this.computeEgoisticUtility(filtered);

        if (this.filters.useRelUtility) {
            this.computeRelativeUtility(filtered, examPerfMap);
        }

        if (this.filters.useRelUtility && this.filters.useUtility) {
            filtered.sort((a,b) => b.u_rel - a.u_rel || b.u_ego - a.u_ego);
        } else if (this.filters.useRelUtility) {
            filtered.sort((a,b) => b.u_rel - a.u_rel);
        } else if (this.filters.useUtility) {
            filtered.sort((a,b) => b.u_ego - a.u_ego);
        } else {
            for (let i = filtered.length - 1; i > 0; i--) { 
                const j = Math.floor(Math.random() * (i + 1)); 
                [filtered[i], filtered[j]] = [filtered[j], filtered[i]]; 
            }
        }

        if (this.filters.maxQuestions > 0) filtered = filtered.slice(0, this.filters.maxQuestions);
        this.currentQuestions = filtered.map(q => q.file); 
        this.currentIndex = 0;
    }

    // ============================================================
    // MODO LIVRE
    // ============================================================
    async renderModoLivre() {
        await this.buildFilterUI(this.contentArea, "livre");
        this.cardContainer = this.contentArea.createDiv({ cls: "qb-card-container" });
    }

    async renderCurrentCard() {
        if (this.isRendering) return;
        this.isRendering = true;
        this.cardContainer.empty();

        try {
            if (this.currentQuestions.length === 0) {
                this.cardContainer.createEl("p", { text: "Nenhuma questão localizada com os parâmetros atuais." });
                return;
            }
            
            const file = this.currentQuestions[this.currentIndex];
            const content = await this.app.vault.read(file);
            const cache = this.app.metadataCache.getFileCache(file);
            const fm = cache?.frontmatter || {};

            const regexPergunta = /\*\*Pergunta:\*\*\n([\s\S]*?)\?/;
            const regexRespostas = /\?\n\*\*Respostas:\*\*\n([\s\S]*?)\*\*Desenvolvimento \/ Solução:\*\*/;
            const regexSolucao = /\*\*Desenvolvimento \/ Solução:\*\*\n([\s\S]*)/;

            const perguntaMatch = content.match(regexPergunta);
            const respostasMatch = content.match(regexRespostas);
            const solucaoMatch = content.match(regexSolucao);

            const header = this.cardContainer.createDiv({ cls: "qb-header" });
            header.createEl("span", { text: `Questão ${this.currentIndex + 1} de ${this.currentQuestions.length}` });
            const openFileBtn = header.createEl("button", { text: "⚙️", cls: "qb-gear-btn" });
            openFileBtn.onclick = () => this.app.workspace.getLeaf(false).openFile(file);

            const metaDiv = this.cardContainer.createDiv({ cls: "qb-inline-meta-container" });
            const qMeta = this.allQuestionsMetadata.find(m => m.file.path === file.path);
            const tagText = qMeta && qMeta.fullTag ? `#${qMeta.fullTag}` : "Sem tag";
            const diffText = fm.dificuldade !== undefined ? fm.dificuldade : "0";
            metaDiv.createEl("span", { text: `${tagText} (Nív. ${diffText})` });

            const cardBody = this.cardContainer.createDiv({ cls: "qb-card" });
            if (perguntaMatch) {
                await obsidian.MarkdownRenderer.renderMarkdown(perguntaMatch[1], cardBody, file.path, this);
            }

            const hiddenSection = this.cardContainer.createDiv({ cls: "qb-hidden-section", attr: { style: "display: none;" } });
            
            const respDiv = hiddenSection.createDiv({ cls: "qb-sub-block" });
            respDiv.createEl("strong", { text: "Respostas:" });
            if (respostasMatch) await obsidian.MarkdownRenderer.renderMarkdown(respostasMatch[1], respDiv, file.path, this);

            const solDiv = hiddenSection.createDiv({ cls: "qb-sub-block" });
            solDiv.createEl("strong", { text: "Desenvolvimento / Solução:" });
            if (solucaoMatch) await obsidian.MarkdownRenderer.renderMarkdown(solucaoMatch[1], solDiv, file.path, this);

            const showBtn = this.cardContainer.createEl("button", { text: "Mostrar Resposta e Solução", cls: "qb-action-btn" });
            showBtn.onclick = () => { 
                hiddenSection.style.display = "block"; 
                showBtn.style.display = "none"; 
            };

            const feedbackDiv = this.cardContainer.createDiv({ cls: "qb-feedback" });
            const acertosCount = fm.acertos || 0;
            const errosCount = fm.erros || 0;
            const resolvidoFlag = fm.resolvido || 0;

            const hitBtn = feedbackDiv.createEl("button", { text: `Acertos: ${acertosCount}`, cls: "qb-btn-green" });
            const missBtn = feedbackDiv.createEl("button", { text: `Erros: ${errosCount}`, cls: "qb-btn-red" });
            const toggleResolvidoBtn = feedbackDiv.createEl("button", { text: resolvidoFlag ? "Status: Resolvido" : "Status: Pendente", cls: resolvidoFlag ? "qb-btn-resolvido" : "qb-btn-pendente" });
            const undoBtn = feedbackDiv.createEl("button", { text: "↺ Desfazer", cls: "qb-btn-undo", title: "Desfazer alteração" });

            hitBtn.onclick = () => this.updateScore(file, "acertos");
            missBtn.onclick = () => this.updateScore(file, "erros");
            toggleResolvidoBtn.onclick = () => this.toggleResolvido(file);
            undoBtn.onclick = () => this.undoLastScore();

            const linkSection = this.cardContainer.createDiv({ cls: "qb-link-section" });
            linkSection.createEl("strong", { text: "Nota Referência: " });
            
            const currentLinkText = fm.nota_link ? fm.nota_link : "Nenhuma";
            const linkDisplay = linkSection.createEl("span", { text: currentLinkText, cls: "qb-link-display" });
            if (fm.nota_link) {
                linkDisplay.style.cursor = "pointer";
                linkDisplay.style.textDecoration = "underline";
                linkDisplay.style.color = "var(--text-accent)";
                linkDisplay.onclick = () => {
                    const cleanPath = fm.nota_link.replace(/[[\]]/g, '');
                    this.app.workspace.openLinkText(cleanPath, file.path, true);
                };
            }

            const editLinkBtn = linkSection.createEl("button", { text: "🔍 Editar Vinculação", cls: "qb-btn-edit-link" });
            editLinkBtn.onclick = () => {
                new FileSuggestModal(this.app, async (selectedFile) => {
                    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
                        frontmatter.nota_link = `[[${selectedFile.basename}]]`;
                    });
                    this.renderCurrentCard();
                }).open();
            };

            const navDiv = this.cardContainer.createDiv({ cls: "qb-navigation" });
            const prevBtn = navDiv.createEl("button", { text: "◀ Anterior" });
            const nextBtn = navDiv.createEl("button", { text: "Próxima ▶" });

            if (this.currentIndex === 0) prevBtn.disabled = true;
            if (this.currentIndex === this.currentQuestions.length - 1) nextBtn.disabled = true;

            prevBtn.onclick = async () => { this.currentIndex--; await this.renderCurrentCard(); };
            nextBtn.onclick = async () => { this.currentIndex++; await this.renderCurrentCard(); };
        } finally {
            this.isRendering = false;
        }
    }
    
    async updateScore(file, field) {
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
            const prevVal = frontmatter[field] || 0;
            this.actionHistory.push({ filePath: file.path, field, prevVal });
            frontmatter[field] = prevVal + 1;
        });
        setTimeout(async () => { await this.renderCurrentCard(); }, 150);
    }

    async toggleResolvido(file) {
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
            frontmatter.resolvido = frontmatter.resolvido === 1 ? 0 : 1;
        });
        setTimeout(async () => { await this.renderCurrentCard(); }, 150);
    }
    
    async undoLastScore() {
        if (this.actionHistory.length === 0) {
            new obsidian.Notice("Nenhum histórico operacional para reverter.");
            return;
        }
        const { filePath, field, prevVal } = this.actionHistory.pop();
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof obsidian.TFile) {
            await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
                frontmatter[field] = prevVal;
            });
            new obsidian.Notice(`Pontuação de ${field} revertida.`);
        }
        setTimeout(async () => { await this.renderCurrentCard(); }, 150);
    }

    // ============================================================
    // MODO PROVA
    // ============================================================
    async renderModoProva() {
        if (this.activeExam) { await this.renderExamUI(); return; }
        await this.buildFilterUI(this.contentArea, "provas");

        const basePath = this.plugin.settings.basePath || "";
        const folderPath = basePath ? `${basePath}/provas` : "provas";
        try {
            const exists = await this.app.vault.adapter.exists(folderPath);
            if (!exists) await this.app.vault.createFolder(folderPath);
        } catch(e) {
            console.error("Erro ao criar pasta de provas:", e);
            new obsidian.Notice("Não foi possível acessar/criar a pasta de provas.");
            return;
        }
        const allExamFiles = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(folderPath));

        const searchDiv = this.contentArea.createDiv({ cls: "qb-exam-search" });
        const searchInput = searchDiv.createEl("input", { type: "text", placeholder: "Pesquisar provas...", value: this.examSearchQuery });
        searchInput.addEventListener("input", () => {
            this.examSearchQuery = searchInput.value.toLowerCase();
            this.renderExamList(allExamFiles);
        });

        const listDiv = this.contentArea.createDiv({ cls: "qb-exam-list" });
        listDiv.createEl("h3", { text: "Provas Disponíveis" });
        this.renderExamList(allExamFiles, listDiv);
    }

    renderExamList(files, listDiv = null) {
        if (!listDiv) {
            const existingList = this.contentArea.querySelector(".qb-exam-list");
            if (existingList) existingList.empty();
            listDiv = existingList || this.contentArea.createDiv({ cls: "qb-exam-list" });
        }
        listDiv.empty();
        const query = this.examSearchQuery;
        const filteredFiles = files.filter(f => !query || f.basename.toLowerCase().includes(query));
        
        if (filteredFiles.length === 0) {
            listDiv.createEl("p", { text: "Nenhuma prova encontrada." });
            return;
        }
        
        for (const f of filteredFiles) {
            const card = listDiv.createDiv({ cls: "qb-exam-card" });
            const headerRow = card.createDiv({ cls: "qb-exam-card-header" });
            headerRow.createEl("strong", { text: f.basename });
            
            const btn = headerRow.createEl("button", { text: "▶ Iniciar", cls: "qb-btn-start" });
            btn.onclick = () => {
                new ExamTimeModal(this.app, (minutes) => {
                    this.startExam(f, minutes);
                }).open();
            };

            const cache = this.app.metadataCache.getFileCache(f);
            const filters = cache?.frontmatter?.filtros;
            if (filters) {
                const details = card.createEl("details", { cls: "qb-exam-filter-details" });
                details.createEl("summary", { text: "Filtros usados na geração" });
                details.createEl("pre", { text: JSON.stringify(filters, null, 2) });
            }
        }
    }

    async generateExamFile(name) {
        if(this.currentQuestions.length === 0) { 
            new obsidian.Notice("Nenhuma questão encontrada com os filtros."); 
            return; 
        }
        const basePath = this.plugin.settings.basePath || "";
        const folderPath = basePath ? `${basePath}/provas` : "provas";
        try {
            const exists = await this.app.vault.adapter.exists(folderPath);
            if (!exists) await this.app.vault.createFolder(folderPath);
        } catch(e) {
            console.error(e);
            new obsidian.Notice("Erro ao criar pasta de provas.");
            return;
        }
        
        let fileName = name;
        if (!fileName.endsWith(".md")) fileName += ".md";
        const filePath = `${folderPath}/${fileName}`;
        
        let content = `---\ntipo: prova\nfiltros: ${JSON.stringify(this.filters)}\ntentativas: []\n---\n\n`;
        this.currentQuestions.forEach(file => { content += `![[${file.basename}]]\n`; });
        
        await this.app.vault.create(filePath, content);
        new obsidian.Notice("Prova gerada!");
        await this.loadTabContent();
    }

    async startExam(file, minutes) {
        try {
            const content = await this.app.vault.read(file);
            const links = Array.from(content.matchAll(/!\[\[(.*?)\]\]/g)).map(m => m[1]);
            const allFiles = this.app.vault.getMarkdownFiles();
            const examQFiles = links.map(l => allFiles.find(f => f.basename === l)).filter(Boolean);

            if(examQFiles.length === 0) { 
                new obsidian.Notice("Nenhuma questão válida encontrada na prova."); 
                return; 
            }

            this.activeExam = {
                file: file,
                questions: examQFiles,
                timeSeconds: minutes * 60,
                elapsed: 0,
                interval: null,
                answers: new Array(examQFiles.length).fill(null)
            };
            await this.renderExamUI();
        } catch(e) {
            console.error(e);
            new obsidian.Notice("Erro ao iniciar prova: " + e.message);
            this.activeExam = null;
        }
    }

    async renderExamUI() {
        this.contentArea.empty();
        if (!this.activeExam) return;
        
        try {
            const header = this.contentArea.createDiv({ cls: "qb-exam-header" });
            header.createEl("h2", { text: this.activeExam.file.basename });
            const timerDisplay = header.createEl("span", { cls: "qb-exam-timer" });
            
            if (!this.activeExam.interval) {
                this.activeExam.interval = setInterval(() => {
                    this.activeExam.elapsed++;
                    const rem = this.activeExam.timeSeconds - this.activeExam.elapsed;
                    if(rem <= 0) { 
                        this.finishExam(true); 
                    } else {
                        const m = Math.floor(rem / 60); 
                        const s = rem % 60;
                        if (timerDisplay) {
                            timerDisplay.innerText = `Tempo Restante: ${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
                        }
                    }
                }, 1000);
            }

            const container = this.contentArea.createDiv({ cls: "qb-exam-scroll-area" });
            for (let i = 0; i < this.activeExam.questions.length; i++) {
                const file = this.activeExam.questions[i];
                const content = await this.app.vault.read(file);
                const regexPergunta = /\*\*Pergunta:\*\*\n([\s\S]*?)\?/;
                const match = content.match(regexPergunta);
                const qDiv = container.createDiv({ cls: "qb-exam-question" });
                qDiv.createEl("strong", { text: `Questão ${i+1}` });
                if (match) {
                    await obsidian.MarkdownRenderer.renderMarkdown(match[1], qDiv, file.path, this);
                } else {
                    qDiv.createEl("p", { text: "Erro ao exibir pergunta." });
                }
            }

            const endBtn = this.contentArea.createEl("button", { text: "Finalizar Prova Antecipadamente", cls: "qb-btn-red" });
            endBtn.onclick = () => this.finishExam(false);
        } catch(e) {
            console.error(e);
            new obsidian.Notice("Erro na interface da prova: " + e.message);
            this.activeExam = null;
        }
    }

    async finishExam(timeOut) {
        if (!this.activeExam) return;
        clearInterval(this.activeExam.interval);
        if(timeOut) new obsidian.Notice("O tempo da prova esgotou!");
        
        this.contentArea.empty();
        this.contentArea.createEl("h2", { text: "Gabarito da Prova" });
        const list = this.contentArea.createDiv({ cls: "qb-gabarito-list" });

        try {
            for (let i = 0; i < this.activeExam.questions.length; i++) {
                const file = this.activeExam.questions[i];
                const content = await this.app.vault.read(file);
                const regexResp = /\?\n\*\*Respostas:\*\*\n([\s\S]*?)\*\*Desenvolvimento /;
                const match = content.match(regexResp);
                
                const item = list.createDiv({ cls: "qb-gabarito-item" });
                item.createEl("strong", { text: `Q${i+1}: ` });
                const respDiv = item.createDiv();
                if(match) {
                    await obsidian.MarkdownRenderer.renderMarkdown(match[1], respDiv, file.path, this);
                } else {
                    respDiv.createEl("span", { text: "Resposta não encontrada." });
                }

                const btnContainer = item.createDiv({ cls: "qb-gabarito-actions" });
                const btnAcerto = btnContainer.createEl("button", { text: "Acertou", cls: "qb-btn-green" });
                const btnErro = btnContainer.createEl("button", { text: "Errou", cls: "qb-btn-red" });

                btnAcerto.onclick = () => { 
                    this.activeExam.answers[i] = 'hit'; 
                    btnAcerto.style.opacity = 1; 
                    btnErro.style.opacity = 0.5; 
                };
                btnErro.onclick = () => { 
                    this.activeExam.answers[i] = 'miss'; 
                    btnErro.style.opacity = 1; 
                    btnAcerto.style.opacity = 0.5; 
                };
            }

            const saveBtn = this.contentArea.createEl("button", { text: "Salvar Resultados", cls: "qb-btn-generate" });
            saveBtn.onclick = async () => {
                let acertos = this.activeExam.answers.filter(a => a === 'hit').length;
                let erros = this.activeExam.answers.filter(a => a === 'miss').length;
                const answersDetail = this.activeExam.questions.map((q, i) => ({
                    q: q.basename,
                    r: this.activeExam.answers[i]
                }));
                
                await this.app.fileManager.processFrontMatter(this.activeExam.file, (fm) => {
                    if(!fm.tentativas) fm.tentativas = [];
                    fm.tentativas.push({
                        data: window.moment ? window.moment().format("YYYY-MM-DDTHH:mm") : new Date().toISOString(),
                        tempoUsado: this.activeExam.elapsed,
                        acertos: acertos,
                        erros: erros,
                        answersDetail: answersDetail
                    });
                });
                new obsidian.Notice("Resultados salvos na prova!");
                this.activeExam = null;
                await this.loadTabContent();
            };
        } catch(e) {
            console.error(e);
            new obsidian.Notice("Erro ao finalizar prova.");
            this.activeExam = null;
        }
    }

    // ============================================================
    // ESTATÍSTICAS
    // ============================================================
    async renderStats() {
        await this.buildFilterUI(this.contentArea, "stats");
        this.plotContainer = this.contentArea.createDiv({ cls: "qb-stats-container" });
    }

    async renderStatsPlots() {
        this.plotContainer.empty();
        await this.extractMetadataTree();
        const examPerfMap = await this.getExamPerformanceMap();

        let filtered = this.allQuestionsMetadata.filter(q => {
            if (this.filters.fontes.length > 0 && !this.filters.fontes.includes(q.fonte)) return false;
            if (this.filters.areas.length > 0 && !this.filters.areas.includes(q.area)) return false;
            if (this.filters.subareas.length > 0 && !this.filters.subareas.includes(q.subarea)) return false;
            if (this.filters.topicos.length > 0 && !this.filters.topicos.includes(q.topico)) return false;
            return true;
        });

        if (filtered.length === 0) { 
            this.plotContainer.createEl("p", { text: "Sem dados para este filtro." }); 
            return; 
        }

        // --- Seção 1: Utilidade Relativa (baseada em provas) ---
        const blockRel = this.plotContainer.createDiv({ cls: "qb-stat-block" });
        blockRel.createEl("h3", { text: "Utilidade Relativa (Dados de Provas)" });

        const examStats = { 0: { hits: 0, misses: 0 }, 1: { hits: 0, misses: 0 }, 2: { hits: 0, misses: 0 }, 3: { hits: 0, misses: 0 }, 4: { hits: 0, misses: 0 }, 5: { hits: 0, misses: 0 } };
        filtered.forEach(q => {
            const d = q.dificuldade;
            if (d < 0 || d > 5) return;
            const perf = examPerfMap.get(q.file.path);
            if (perf) {
                examStats[d].hits += perf.hits;
                examStats[d].misses += perf.misses;
            }
        });

        const examRates = {};
        for (let d = 0; d <= 5; d++) {
            const tot = examStats[d].hits + examStats[d].misses;
            examRates[d] = tot > 0 ? examStats[d].misses / tot : 0.5;
        }

        filtered.forEach(q => {
            const d = q.dificuldade;
            const E = examRates[d] || 0.5;
            q.u_rel = (E / (d + 1)) + (Math.pow(d, 2) * Math.pow(Math.max(0, E - 0.4), 3));
        });

        for (let d = 0; d <= 5; d++) {
            const qs = filtered.filter(q => q.dificuldade === d);
            const count = qs.length;
            if (count === 0) continue;

            const avgUrel = qs.reduce((acc, q) => acc + (q.u_rel || 0), 0) / count;
            const errPrc = (examRates[d] * 100).toFixed(1);

            const row = blockRel.createDiv({ cls: "qb-stat-row" });
            row.createEl("span", { text: `Nív. ${d}`, cls: "qb-stat-label" });
            const barWrap = row.createDiv({ cls: "qb-bar-wrapper" });
            barWrap.createDiv({ cls: "qb-bar-fill rel", attr: { style: `width: ${Math.min(100, avgUrel * 30)}%;` } });
            barWrap.createEl("span", { text: `U_rel: ${avgUrel.toFixed(2)} | Erros: ${errPrc}% (${count} Qs)`, cls: "qb-bar-text" });
        }

        // --- Seção 2: Utilidade Egoísta (dados estáticos) ---
        const blockEgo = this.plotContainer.createDiv({ cls: "qb-stat-block" });
        blockEgo.createEl("h3", { text: "Utilidade Egoísta (Dados do Modo Livre)" });
        this.computeEgoisticUtility(filtered);

        const bins = { "Alta (>5)": 0, "Média (1-5)": 0, "Baixa (<1)": 0 };
        filtered.forEach(q => {
            if (q.u_ego > 5) bins["Alta (>5)"]++;
            else if (q.u_ego >= 1) bins["Média (1-5)"]++;
            else bins["Baixa (<1)"]++;
        });

        Object.entries(bins).forEach(([label, qty]) => {
            const row = blockEgo.createDiv({ cls: "qb-stat-row" });
            row.createEl("span", { text: label, cls: "qb-stat-label" });
            const barWrap = row.createDiv({ cls: "qb-bar-wrapper" });
            const pct = (qty / filtered.length) * 100;
            barWrap.createDiv({ cls: "qb-bar-fill ego", attr: { style: `width: ${pct}%;` } });
            barWrap.createEl("span", { text: `${qty} Qs (${pct.toFixed(1)}%)`, cls: "qb-bar-text" });
        });
    }
}

// ============================================================
// Plugin
// ============================================================
class QuestionBankPlugin extends obsidian.Plugin {
    async onload() {
        this.settings = Object.assign({ basePath: '' }, await this.loadData());
        this.registerView("question-bank-view", (leaf) => new QuestionBankView(leaf, this));
        this.addRibbonIcon('dice', 'Banco de Questões', () => this.activateView());
        this.addSettingTab(new QuestionBankSettingTab(this.app, this));
    }
    async activateView() {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType("question-bank-view")[0];
        if (!leaf) { leaf = workspace.getRightLeaf(false); await leaf.setViewState({ type: "question-bank-view", active: true }); }
        workspace.revealLeaf(leaf);
    }
    async saveSettings() { await this.saveData(this.settings); }
}

module.exports = QuestionBankPlugin;
