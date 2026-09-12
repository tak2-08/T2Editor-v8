//Path: T2Editor/js/core.js

class T2Editor {
    constructor(container) {
        this.container = container;
        this.editor = container.querySelector('.t2-editor');
        this.toolbar = container.querySelector('.t2-toolbar');
        this.plugins = new Map();
        this.pluginLoadStatus = new Map();
        this.pluginLoadPromises = new Map();
        this.contentSetQueue = null;
        
        this.config = {
            autoSave: true,
            plugins: window.T2EDITOR_PLUGINS || []
        };
        
        this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                     (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        this.isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        
        this.alignmentState = 'left';
        this.bulletState = { active: false, type: null, count: 1 };
        this.undoStack = [];
        this.redoStack = [];
        this.lastCheckpoint = null;
        this.savedSelection = null;
        
        this.undoBtn = container.querySelector('[data-command="undo"]');
        this.redoBtn = container.querySelector('[data-command="redo"]');
        this.charCount = container.querySelector('.t2-char-count span');
        
        this.autoSaveEnabled = localStorage.getItem('t2editor-autosave-enabled') !== 'false';
        this.collab = null;
        
        this.init();
    }

    init() {
        this.setupEditor();
        this.setupEventListeners();
        this.setupAutoSaveToggle();
        this.setupBeforeUnload();
        
        if (this.autoSaveEnabled) {
            this.loadAutoSave();
        }
        
        this.updateUndoRedoButtons();
        this.updateCharCount();
        this.loadPluginsWithPriority();
    }

    setupEditor() {
        const p = document.createElement('p');
        p.innerHTML = '<br>';
        this.editor.appendChild(p);
        
        this.editor.style.whiteSpace = 'pre-wrap';
        this.editor.style.wordBreak = 'break-word';
    }

    setupEventListeners() {
        this.toolbar.addEventListener('click', (e) => {
            const button = e.target.closest('.t2-btn');
            if (!button) return;
            
            e.preventDefault();
            e.stopPropagation();
            
            const command = button.dataset.command;
            this.handleCommand(command, button);
        });

        document.addEventListener('selectionchange', () => {
            if (document.activeElement === this.editor || this.editor.contains(document.activeElement)) {
                this.updateFormatButtons();
            }
        });

        if (this.isIOS || this.isSafari) {
            this.editor.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace') {
                    this.handleBackspace(e);
                }
            });
        } else {
            this.editor.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.handleEnterKey();
                } else if (e.key === 'Backspace') {
                    this.handleBackspace(e);
                }
            });
        }

        this.editor.addEventListener('input', (e) => {
            this.handleInput(e);
        });

        this.editor.addEventListener('paste', async (e) => {
            await this.handlePaste(e);
        });

        this.editor.addEventListener('DOMNodeInserted', (e) => {
            this.handleNodeInserted(e);
        });
    }

    updateFormatButtons() {
        const formatCommands = ['bold', 'italic', 'underline', 'strikeThrough'];
        
        formatCommands.forEach(command => {
            const button = this.toolbar.querySelector(`[data-command="${command}"]`);
            if (!button) return;
            
            try {
                const isActive = document.queryCommandState(command);
                if (isActive) {
                    button.classList.add('active');
                } else {
                    button.classList.remove('active');
                }
            } catch (e) {
                // queryCommandState 실패 시 무시
            }
        });
    }

    async handleCommand(command, button) {
        const pluginName = button.dataset.plugin;
        
        if (pluginName && !this.plugins.has(pluginName)) {
            this.showButtonLoading(button);
            await this.loadPluginImmediately(pluginName);
            this.hideButtonLoading(button);
        }
        
        for (let [name, plugin] of this.plugins) {
            if (plugin.commands && plugin.commands.includes(command)) {
                console.log(`Command '${command}' handled by plugin '${name}'`);
                plugin.handleCommand(command, button);
                this.createUndoPoint();
                return;
            }
        }

        switch(command) {
            case 'undo':
                this.undo();
                break;
            case 'redo':
                this.redo();
                break;
            case 'fontSize':
                this.showFontSizeList(button);
                break;
            case 'justifyContent':
                this.toggleAlignment(button);
                break;
            case 'foreColor':
            case 'backColor':
                this.saveSelection();
                this.showColorPalette(command, button);
                break;
            case 'bold':
            case 'italic':
            case 'underline':
            case 'strikeThrough':
                this.execCommand(command);
                this.editor.focus();
                setTimeout(() => this.updateFormatButtons(), 0);
                break;
            default:
                console.warn(`Unknown command: ${command}`);
                break;
        }
        
        this.createUndoPoint();
    }

    async loadPluginImmediately(pluginName) {
        if (this.pluginLoadPromises.has(pluginName)) {
            return this.pluginLoadPromises.get(pluginName);
        }
        
        if (this.pluginLoadStatus.get(pluginName) === 'loaded') {
            return Promise.resolve();
        }
        
        console.log(`Loading plugin '${pluginName}' immediately due to user interaction`);
        
        const loadPromise = this.loadPlugin(pluginName);
        this.pluginLoadPromises.set(pluginName, loadPromise);
        
        try {
            await loadPromise;
        } finally {
            this.pluginLoadPromises.delete(pluginName);
        }
    }

    async loadPluginsWithPriority() {
        const priorities = window.T2EDITOR_PLUGIN_PRIORITY || {};
        
        const priorityGroups = new Map();
        const unassignedPlugins = [];
        
        this.config.plugins.forEach(pluginName => {
            const priority = priorities[pluginName];
            
            if (priority === undefined || priority === null) {
                unassignedPlugins.push(pluginName);
            } else {
                if (!priorityGroups.has(priority)) {
                    priorityGroups.set(priority, []);
                }
                priorityGroups.get(priority).push(pluginName);
            }
        });
        
        const sortedPriorities = Array.from(priorityGroups.keys()).sort((a, b) => a - b);
        
        if (unassignedPlugins.length > 0) {
            const maxPriority = sortedPriorities.length > 0 ? 
                Math.max(...sortedPriorities) + 1 : 1;
            sortedPriorities.push(maxPriority);
            priorityGroups.set(maxPriority, unassignedPlugins);
        }
        
        for (const priority of sortedPriorities) {
            const plugins = priorityGroups.get(priority);
            
            const pluginsWithSize = await Promise.all(
                plugins.map(async (name) => {
                    const size = await this.getPluginFileSize(name);
                    return { name, size };
                })
            );
            
            pluginsWithSize.sort((a, b) => a.size - b.size);
            priorityGroups.set(priority, pluginsWithSize.map(p => p.name));
        }
        
        const buttons = this.toolbar.querySelectorAll('.t2-btn[data-plugin]');
        buttons.forEach(button => {
            const pluginName = button.dataset.plugin;
            if (this.config.plugins.includes(pluginName)) {
                this.showButtonLoading(button);
            }
        });
        
        if (sortedPriorities.includes(0)) {
            const immediatePlugins = priorityGroups.get(0);
            console.log(`Loading priority 0 plugins immediately:`, immediatePlugins);
            
            await Promise.all(
                immediatePlugins.map(async (pluginName) => {
                    await this.loadPlugin(pluginName);
                    const button = this.toolbar.querySelector(`[data-plugin="${pluginName}"]`);
                    if (button) {
                        this.hideButtonLoading(button);
                    }
                })
            );
        }
        
        const delayedPriorities = sortedPriorities.filter(p => p > 0);
        
        for (let i = 0; i < delayedPriorities.length; i++) {
            const priority = delayedPriorities[i];
            const plugins = priorityGroups.get(priority);
            
            const groupDelay = i * 50;
            
            setTimeout(async () => {
                console.log(`Loading priority ${priority} plugins:`, plugins);
                
                await Promise.all(
                    plugins.map(async (pluginName) => {
                        await this.loadPlugin(pluginName);
                        const button = this.toolbar.querySelector(`[data-plugin="${pluginName}"]`);
                        if (button) {
                            this.hideButtonLoading(button);
                        }
                    })
                );
                
                if (this.contentSetQueue) {
                    console.log('Processing queued content after plugin load');
                    this.processContentSet(this.contentSetQueue);
                    this.contentSetQueue = null;
                }
            }, groupDelay);
        }
    }

    async getPluginFileSize(pluginName) {
        try {
            const url = `${window.T2EDITOR_URL}/plugin/${pluginName}/${pluginName}.js`;
            
            const response = await fetch(url, { method: 'HEAD' });
            const contentLength = response.headers.get('content-length');
            
            if (contentLength) {
                return parseInt(contentLength, 10);
            }
            
            const fullResponse = await fetch(url);
            const blob = await fullResponse.blob();
            return blob.size;
        } catch (error) {
            console.warn(`Failed to get size for plugin ${pluginName}:`, error);
            return 50000;
        }
    }

    async loadPlugin(name) {
        if (this.pluginLoadStatus.get(name) === 'loaded') {
            return Promise.resolve();
        }
        
        this.pluginLoadStatus.set(name, 'loading');
        
        return new Promise((resolve, reject) => {
            try {
                const script = document.createElement('script');
                script.src = `${window.T2EDITOR_URL}/plugin/${name}/${name}.js`;
                
                script.onload = () => {
                    const className = `T2${name.charAt(0).toUpperCase() + name.slice(1)}Plugin`;
                    if (window[className]) {
                        const PluginClass = window[className];
                        const plugin = new PluginClass(this);
                        this.plugins.set(name, plugin);
                        this.pluginLoadStatus.set(name, 'loaded');
                        console.log(`✓ Plugin ${name} loaded successfully`);
                        
                        if (name === 'collab') {
                            this.collab = plugin;
                        }
                        
                        resolve();
                    } else {
                        console.error(`Plugin class ${className} not found`);
                        this.pluginLoadStatus.set(name, 'failed');
                        reject(new Error(`Plugin class not found: ${className}`));
                    }
                };
                
                script.onerror = (e) => {
                    console.error(`✗ Failed to load plugin ${name}:`, e);
                    this.pluginLoadStatus.set(name, 'failed');
                    reject(e);
                };
                
                document.head.appendChild(script);
            } catch (error) {
                console.error(`Failed to load plugin ${name}:`, error);
                this.pluginLoadStatus.set(name, 'failed');
                reject(error);
            }
        });
    }

    handleInput(e) {
        this.autoSave();
        this.handleBulletPoints();
        
        if (this.isIOS || this.isSafari) {
            requestAnimationFrame(() => {
                this.normalizeContent();
            });
        } else {
            this.normalizeContent();
        }
        
        this.createUndoPoint();
        this.updateCharCount();
    }

    handleEnterKey() {
        const selection = window.getSelection();
        const range = selection.getRangeAt(0);
        
        let currentBlock = this.getClosestBlock(range.startContainer);
        
        if (!currentBlock || currentBlock === this.editor) {
            currentBlock = document.createElement('p');
            currentBlock.innerHTML = '<br>';
            this.editor.appendChild(currentBlock);
            this.setCaretToStart(currentBlock);
            return;
        }
        
        const newBlock = document.createElement('p');
        
        if (range.collapsed) {
            const beforeRange = document.createRange();
            beforeRange.selectNodeContents(currentBlock);
            beforeRange.setEnd(range.startContainer, range.startOffset);
            const afterRange = document.createRange();
            afterRange.selectNodeContents(currentBlock);
            afterRange.setStart(range.startContainer, range.startOffset);
            
            const beforeContent = beforeRange.cloneContents();
            const afterContent = afterRange.cloneContents();
            
            if (beforeContent.textContent.trim()) {
                currentBlock.innerHTML = '';
                currentBlock.appendChild(beforeContent);
            } else {
                currentBlock.innerHTML = '<br>';
            }
            
            if (afterContent.textContent.trim()) {
                newBlock.appendChild(afterContent);
            } else {
                newBlock.innerHTML = '<br>';
            }
        } else {
            newBlock.innerHTML = '<br>';
        }
        
        currentBlock.parentNode.insertBefore(newBlock, currentBlock.nextSibling);
        this.setCaretToStart(newBlock);
        
        this.normalizeContent();
        this.createUndoPoint();
        this.autoSave();
    }

    handleBackspace(e) {
        const selection = window.getSelection();
        const range = selection.getRangeAt(0);
        
        if (this.editor.childNodes.length <= 1) {
            const onlyBlock = this.editor.firstElementChild;
            if (!onlyBlock || onlyBlock.textContent.trim() === '') {
                e.preventDefault();
                if (!onlyBlock || onlyBlock.tagName !== 'P') {
                    this.resetEditor();
                }
                return;
            }
        }
        
        if (range.collapsed && this.isAtBlockStart(range)) {
            e.preventDefault();
            
            const currentBlock = this.getClosestBlock(range.startContainer);
            if (!currentBlock || currentBlock === this.editor) return;
            
            const previousBlock = currentBlock.previousElementSibling;
            if (!previousBlock) return;
            
            this.mergeBlocks(previousBlock, currentBlock);
            this.createUndoPoint();
        }
        
        setTimeout(() => this.normalizeContent(), 0);
    }

    async handlePaste(e) {
        for (let [name, plugin] of this.plugins) {
            if (plugin.handlePaste) {
                const handled = await plugin.handlePaste(e);
                if (handled) {
                    return;
                }
            }
        }

        e.preventDefault();
        
        const selection = window.getSelection();
        if (!selection.rangeCount) return;
        
        const range = selection.getRangeAt(0);
        
        const clipboardData = e.clipboardData || window.clipboardData;
        const pastedData = clipboardData ? 
            (clipboardData.getData('text/html') || clipboardData.getData('text/plain')) : 
            null;

        const insertContent = (content) => {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = content;
            
            const hasHTML = tempDiv.children.length > 0 || /<[^>]+>/.test(content);
            
            if (!range.collapsed) {
                range.deleteContents();
            }
            
            let currentBlock = this.getClosestBlock(range.startContainer);
            
            if (!currentBlock || currentBlock === this.editor) {
                currentBlock = document.createElement('p');
                currentBlock.innerHTML = '<br>';
                this.editor.appendChild(currentBlock);
            }
            
            const cursorOffset = range.startOffset;
            const originalText = currentBlock.textContent;
            const beforeText = originalText.substring(0, cursorOffset);
            const afterText = originalText.substring(cursorOffset);
            
            if (hasHTML) {
                const sanitizedHTML = this.sanitizeHTML(content);
                currentBlock.innerHTML = beforeText + sanitizedHTML + afterText;
                const newOffset = beforeText.length + tempDiv.textContent.length;
                this.setCaretPosition(currentBlock, newOffset);
            } else {
                const plainText = tempDiv.textContent || tempDiv.innerText || '';
                const newContent = beforeText + plainText + afterText;
                currentBlock.textContent = newContent;
                const newOffset = beforeText.length + plainText.length;
                this.setCaretPosition(currentBlock, newOffset);
            }
            
            this.normalizeContent();
            this.createUndoPoint();
            this.autoSave();
            this.updateCharCount();
            this.editor.focus();
        };

        if (pastedData) {
            insertContent(pastedData);
        } else {
            try {
                document.execCommand('insertText', false, '');
                setTimeout(() => {
                    this.normalizeContent();
                    this.createUndoPoint();
                    this.autoSave();
                }, 10);
            } catch (err) {
                console.warn('Paste failed:', err);
                alert('붙여넣기에 실패했습니다. Ctrl+V를 다시 시도해주세요.');
            }
        }
    }

    handleNodeInserted(e) {
        if (e.target.nodeType === Node.TEXT_NODE && e.target.parentNode === this.editor) {
            const p = document.createElement('p');
            e.target.parentNode.insertBefore(p, e.target);
            p.appendChild(e.target);
            this.normalizeContent();
        }
    }

    getClosestBlock(node) {
        const blockTags = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE'];
        while (node && node !== this.editor) {
            if (blockTags.includes(node.nodeName)) {
                return node;
            }
            node = node.parentNode;
        }
        return null;
    }

    isBlockElement(element) {
        const blockTags = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE'];
        return blockTags.includes(element.tagName);
    }

    isAtBlockStart(range) {
        const block = this.getClosestBlock(range.startContainer);
        if (!block) return false;
        
        const blockRange = document.createRange();
        blockRange.selectNodeContents(block);
        blockRange.collapse(true);
        
        return range.compareBoundaryPoints(Range.START_TO_START, blockRange) === 0;
    }

    setCaretToStart(element) {
        const range = document.createRange();
        const selection = window.getSelection();
        
        let target = element.firstChild;
        while (target && target.nodeType === Node.ELEMENT_NODE && target.tagName !== 'BR') {
            target = target.firstChild;
        }
        
        if (!target) {
            range.setStart(element, 0);
        } else if (target.nodeType === Node.TEXT_NODE) {
            range.setStart(target, 0);
        } else {
            range.setStartBefore(target);
        }
        
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    setCaretPosition(element, offset) {
        const range = document.createRange();
        const selection = window.getSelection();
        
        function findTextNode(node, offset) {
            let currentOffset = 0;
            
            const walk = document.createTreeWalker(
                node,
                NodeFilter.SHOW_TEXT,
                null,
                false
            );
            
            let textNode;
            while (textNode = walk.nextNode()) {
                const length = textNode.textContent.length;
                if (currentOffset + length >= offset) {
                    return {
                        node: textNode,
                        offset: offset - currentOffset
                    };
                }
                currentOffset += length;
            }
            
            return {
                node: walk.previousNode() || element,
                offset: walk.previousNode() ? walk.previousNode().textContent.length : 0
            };
        }
        
        const target = findTextNode(element, offset);
        
        try {
            range.setStart(target.node, Math.min(target.offset, target.node.length || 0));
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
            element.focus();
        } catch (e) {
            console.warn('Caret positioning failed:', e);
            range.setStart(element, 0);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }

    mergeBlocks(target, source) {
        const caretPosition = target.textContent.length;
        
        if (target.innerHTML === '<br>') {
            target.innerHTML = '';
        }
        if (source.innerHTML === '<br>') {
            source.innerHTML = '';
        }
        
        while (source.firstChild) {
            target.appendChild(source.firstChild);
        }
        source.remove();
        
        this.setCaretPosition(target, caretPosition);
        this.normalizeContent();
    }

    normalizeContent() {
        const blocks = Array.from(this.editor.childNodes);
        let lastMediaBlock = null;

        blocks.forEach((node, index) => {
            if (node.nodeType === Node.TEXT_NODE) {
                const p = document.createElement('p');
                node.parentNode.insertBefore(p, node);
                p.appendChild(node);
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const isMediaBlock = node.classList?.contains('t2-media-block') ||
                                   node.classList?.contains('t2-code-block') ||
                                   node.classList?.contains('t2-file-block');

                if (isMediaBlock) {
                    node.contentEditable = false;
                    
                    let prevSibling = node.previousElementSibling;
                    let emptyCount = 0;
                    
                    while (prevSibling && prevSibling.tagName === 'P' && 
                           !prevSibling.textContent.trim() && 
                           (prevSibling.innerHTML === '<br>' || prevSibling.querySelector('br'))) {
                        emptyCount++;
                        const toRemove = prevSibling;
                        prevSibling = prevSibling.previousElementSibling;
                        
                        if (emptyCount > 1) {
                            toRemove.remove();
                        }
                    }
                    
                    let nextSibling = node.nextElementSibling;
                    emptyCount = 0;
                    
                    while (nextSibling && nextSibling.tagName === 'P' && 
                           !nextSibling.textContent.trim() && 
                           (nextSibling.innerHTML === '<br>' || nextSibling.querySelector('br'))) {
                        emptyCount++;
                        const toRemove = nextSibling;
                        nextSibling = nextSibling.nextElementSibling;
                        
                        if (emptyCount > 1) {
                            toRemove.remove();
                        }
                    }
                    
                    lastMediaBlock = node;
                } else {
                    if (!node.textContent.trim() && !node.querySelector('br, img, iframe, video')) {
                        if (this.isIOS || this.isSafari) {
                            node.innerHTML = '<br>';
                        } else {
                            node.innerHTML = '\u200B<br>';
                        }
                    }
                }
            }
        });

        if (!this.editor.firstChild) {
            const p = document.createElement('p');
            if (this.isIOS || this.isSafari) {
                p.innerHTML = '<br>';
            } else {
                p.innerHTML = '\u200B<br>';
            }
            this.editor.appendChild(p);
        }
    }

    cleanupPastedHTML(element) {
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_ELEMENT,
            null,
            false
        );
        
        const nodesToRemove = [];
        let node;
        
        while (node = walker.nextNode()) {
            node.removeAttribute('style');
            node.removeAttribute('class');
            
            if (['STYLE', 'SCRIPT', 'META'].includes(node.tagName)) {
                nodesToRemove.push(node);
            }
            
            if (this.isBlockElement(node) && !node.textContent.trim()) {
                node.innerHTML = '<br>';
            }
        }
        
        nodesToRemove.forEach(node => node.parentNode.removeChild(node));
    }

    resetEditor() {
        const p = document.createElement('p');
        p.innerHTML = '<br>';
        this.editor.innerHTML = '';
        this.editor.appendChild(p);
        this.setCaretToStart(p);
    }

    createUndoPoint() {
        const currentContent = this.editor.innerHTML;
        if (currentContent === this.lastCheckpoint) return;
        
        this.undoStack.push(this.lastCheckpoint);
        this.lastCheckpoint = currentContent;
        this.redoStack = [];
        
        if (this.undoStack.length > 100) {
            this.undoStack.shift();
        }
        
        this.updateUndoRedoButtons();
    }

    undo() {
        if (this.undoStack.length === 0) return;
        
        const currentContent = this.editor.innerHTML;
        this.redoStack.push(currentContent);
        
        const previousContent = this.undoStack.pop();
        this.lastCheckpoint = previousContent;
        this.editor.innerHTML = previousContent;
        
        this.updateUndoRedoButtons();
    }

    redo() {
        if (this.redoStack.length === 0) return;
        
        const currentContent = this.editor.innerHTML;
        this.undoStack.push(currentContent);
        
        const nextContent = this.redoStack.pop();
        this.lastCheckpoint = nextContent;
        this.editor.innerHTML = nextContent;
        
        this.updateUndoRedoButtons();
    }

    updateUndoRedoButtons() {
        this.undoBtn.disabled = this.undoStack.length === 0;
        this.redoBtn.disabled = this.redoStack.length === 0;
    }

    execCommand(command, value = null) {
        document.execCommand('styleWithCSS', false, true);
        
        switch(command) {
            case 'fontSize':
                const selection = window.getSelection();
                const range = selection.getRangeAt(0);
                
                const span = document.createElement('span');
                span.style.fontSize = value + 'px';
                
                const existingSpan = range.commonAncestorContainer.parentElement;
                if (existingSpan && existingSpan.style.fontSize) {
                    existingSpan.style.fontSize = value + 'px';
                } else {
                    range.surroundContents(span);
                }
                break;
            default:
                document.execCommand(command, false, value);
        }
        
        this.normalizeContent();
    }

    saveSelection() {
        if (window.getSelection) {
            this.savedSelection = window.getSelection().getRangeAt(0).cloneRange();
        }
    }

    restoreSelection() {
        if (this.savedSelection) {
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(this.savedSelection);
        }
    }

    setupAutoSaveToggle() {
        const statusBar = this.container.querySelector('.t2-editor-status');
        const autoSaveToggle = document.createElement('div');
        autoSaveToggle.className = 't2-autosave-toggle';

        // 스크린 리더 접근성 향상을 위해 고유 ID 생성 및 label 연결
        const toggleId = `t2-autosave-${this.generateUid()}`;

        autoSaveToggle.innerHTML = `
            <label class="t2-switch" for="${toggleId}">
                <input type="checkbox" id="${toggleId}" ${this.autoSaveEnabled ? 'checked' : ''}>
                <span class="t2-slider"></span>
            </label>
            <label for="${toggleId}" class="t2-autosave-text">자동 저장</label>
        `;

        const toggleCheckbox = autoSaveToggle.querySelector('input[type="checkbox"]');
        
        toggleCheckbox.addEventListener('change', (e) => {
            this.autoSaveEnabled = e.target.checked;
            localStorage.setItem('t2editor-autosave-enabled', this.autoSaveEnabled);

            if (!this.autoSaveEnabled) {
                this.clearAutoSave();
            } else {
                this.autoSave();
            }
        });

        const logo = statusBar.querySelector('.t2-logo').parentElement;
        logo.parentNode.insertBefore(autoSaveToggle, logo.nextSibling);
    }

    autoSave() {
        if (this.collab) {
            return;
        }

        if (!this.autoSaveEnabled) return;

        const content = this.editor.innerHTML;
        const normalizedContent = content.replace(/<p>\s*<\/p>/g, '<p><br></p>');
        localStorage.setItem('t2editor-autosave', normalizedContent);
    }

    loadAutoSave() {
        if (this.collab) {
            return;
        }

        if (!this.autoSaveEnabled) return;

        const saved = localStorage.getItem('t2editor-autosave');
        if (saved) {
            this.editor.innerHTML = saved;
            this.normalizeContent();
        }
    }

    clearAutoSave() {
        localStorage.removeItem('t2editor-autosave');
    }

    setupBeforeUnload() {
        window.addEventListener('beforeunload', () => {
            if (this.autoSaveEnabled && !this.collab) {
                this.autoSave();
            }
        });
    }

    updateCharCount() {
        let text = this.editor.textContent;
        text = text.replace(/\s+/g, '');
        this.charCount.textContent = text.length;
    }

    showFontSizeList(button) {
        const sizes = ['11', '13', '15', '16', '19', '24', '30', '34', '38'];
        const list = document.createElement('div');
        list.className = 't2-font-size-list';
        list.style.cssText = `
            background: white;
            border: 1px solid #ccc;
            border-radius: 4px;
            padding: 5px 0;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            min-width: 120px;
        `;
        
        const currentFontSize = this.getCurrentFontSize();
        
        sizes.forEach(size => {
            const option = document.createElement('div');
            option.className = 't2-font-size-option';
            
            const isCurrentSize = parseInt(size) === currentFontSize;
            
            const optionContent = document.createElement('div');
            optionContent.style.cssText = `
                display: flex;
                justify-content: space-between;
                align-items: center;
                width: 100%;
            `;
            
            const sizeText = document.createElement('span');
            sizeText.textContent = `${size}px`;
            optionContent.appendChild(sizeText);
            
            if (isCurrentSize) {
                const checkmark = document.createElement('span');
                checkmark.className = 'material-icons';
                checkmark.textContent = 'check';
                checkmark.style.fontSize = '16px';
                checkmark.style.color = '#1a73e8';
                optionContent.appendChild(checkmark);
            }
            
            option.appendChild(optionContent);
            
            option.style.cssText = `
                padding: 5px 15px;
                cursor: pointer;
                font-size: 14px;
                transition: all 0.1s ease;
                ${isCurrentSize ? 'background-color: #e8f0fe; font-weight: 500;' : ''}
            `;
            
            option.addEventListener('mouseenter', () => {
                option.style.backgroundColor = isCurrentSize ? '#d2e3fc' : '#f5f5f5';
            });
            
            option.addEventListener('mouseleave', () => {
                option.style.backgroundColor = isCurrentSize ? '#e8f0fe' : 'transparent';
            });
            
            option.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.execCommand('fontSize', size);
                list.parentElement.remove();
                this.createUndoPoint();
            });
            
            list.appendChild(option);
        });
        
        this.showDropdown(list, button);
    }

    getCurrentFontSize() {
        const selection = window.getSelection();
        if (!selection.rangeCount) return null;
        
        const range = selection.getRangeAt(0);
        let node = range.commonAncestorContainer;
        
        if (node.nodeType === Node.TEXT_NODE) {
            node = node.parentNode;
        }
        
        while (node && node !== this.editor) {
            const fontSize = window.getComputedStyle(node).fontSize;
            if (fontSize && fontSize !== 'inherit') {
                return parseInt(fontSize);
            }
            node = node.parentNode;
        }
        
        return parseInt(window.getComputedStyle(this.editor).fontSize);
    }

    // 5.2.2 버전의 고급 색상 선택기 복구
    showColorPalette(command, button) {
        const self = this;

        // 버튼 위치 계산
        const buttonRect = button.getBoundingClientRect();
        const toolbarRect = this.toolbar.getBoundingClientRect();
        const viewportWidth = window.innerWidth;

        // 팔레트 크기
        const pickerHeight = 325;
        const pickerWidth = pickerHeight * 0.65;

        const pickerContainer = document.createElement('div');
        pickerContainer.className = 't2-color-picker-container';

        // 툴바 기준 상대 위치 계산
        let left = buttonRect.left - toolbarRect.left;

        // 오른쪽으로 벗어나면 조정
        if (buttonRect.left + pickerWidth > viewportWidth - 10) {
            left = viewportWidth - toolbarRect.left - pickerWidth - 10;
        }

        // 왼쪽으로 벗어나면 조정
        if (left < 0) {
            left = 0;
        }

        pickerContainer.style.cssText = `
            position: absolute;
            background: white;
            border-radius: 12px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.15);
            padding: 12px;
            width: ${pickerWidth}px;
            height: ${pickerHeight}px;
            left: ${left}px;
            top: ${buttonRect.bottom - toolbarRect.top + 8}px;
            z-index: 10000;
            overflow: hidden;
            border: 1px solid #ddd;
        `;

        // 현재 색상값 (H, S, L)
        let currentHue = 0;
        let currentSaturation = 100;
        let currentLightness = 50;

        const updateColor = () => {
            const hex = hslToHex(currentHue, currentSaturation, currentLightness);
            colorPreview.style.backgroundColor = hex;
            colorInput.value = hex;
            updateSaturationSlider();
            updateLightnessSlider();
        };

        // --- 상단 hue 컬러 버튼 ---
        const hueSlider = document.createElement('div');
        hueSlider.style.cssText = `
            display: flex;
            gap: 4px;
            margin-bottom: 8px;
            overflow-x: auto;
            padding-bottom: 2px;
        `;
        const hueColors = [
            { hue: 0, color: '#ef4444' }, { hue: 30, color: '#f97316' },
            { hue: 60, color: '#eab308' }, { hue: 120, color: '#22c55e' },
            { hue: 200, color: '#3b82f6' }, { hue: 270, color: '#a855f7' },
            { hue: 330, color: '#ec4899' }, { hue: 240, color: '#6366f1' },
            { hue: 180, color: '#14b8a6' }, { hue: 190, color: '#06b6d4' }
        ];
        hueColors.forEach(({ hue, color }) => {
            const circle = document.createElement('div');
            circle.style.cssText = `
                width: 20px;
                height: 20px;
                border-radius: 50%;
                background-color: ${color};
                cursor: pointer;
                flex-shrink: 0;
                box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                transition: transform 0.15s;
            `;
            circle.addEventListener('mouseenter', () => circle.style.transform = 'scale(1.08)');
            circle.addEventListener('mouseleave', () => circle.style.transform = 'scale(1)');
            circle.addEventListener('click', () => {
                currentHue = hue;
                drawRainbowCanvas();
                updateColor();
                updateIndicators();
            });
            hueSlider.appendChild(circle);
        });

        // --- 메인 영역: 캔버스(레인보우) + 오른쪽 밝기 슬라이더 ---
        const mainArea = document.createElement('div');
        mainArea.style.cssText = `display: flex; gap: 8px; margin-bottom: 8px; height: ${pickerHeight * 0.5}px;`;

        // 캔버스 (무지개)
        const canvasWrapper = document.createElement('div');
        canvasWrapper.style.cssText = `flex: 1; position: relative; border-radius: 12px; overflow: hidden; cursor: crosshair; touch-action: none;`;
        const rainbowCanvas = document.createElement('canvas');
        rainbowCanvas.style.cssText = `width: 100%; height: 100%; display: block;`;
        canvasWrapper.appendChild(rainbowCanvas);

        // 메인 선택 인디케이터
        const mainIndicator = document.createElement('div');
        mainIndicator.style.cssText = `
            position: absolute;
            width: 12px;
            height: 12px;
            border: 2px solid white;
            border-radius: 50%;
            box-shadow: 0 1px 4px rgba(0,0,0,0.3);
            transform: translate(-50%,-50%);
            pointer-events: none;
            left: 50%;
            top: 50%;
        `;
        canvasWrapper.appendChild(mainIndicator);

        // 밝기 슬라이더 (우측 세로)
        const lightnessSlider = document.createElement('div');
        lightnessSlider.style.cssText = `
            width: 24px;
            border-radius: 8px;
            position: relative;
            cursor: pointer;
            touch-action: none;
        `;
        const lightHandle = document.createElement('div');
        lightHandle.style.cssText = `
            position: absolute;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: white;
            border: 2px solid #d1d5db;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
            left: 50%;
            transform: translate(-50%, -50%);
            top: 50%;
        `;
        lightnessSlider.appendChild(lightHandle);

        mainArea.appendChild(canvasWrapper);
        mainArea.appendChild(lightnessSlider);

        // --- 채도 슬라이더 ---
        const saturationSlider = document.createElement('div');
        saturationSlider.style.cssText = `
            width: 100%;
            height: 20px;
            border-radius: 8px;
            position: relative;
            cursor: pointer;
            margin-bottom: 8px;
            touch-action: none;
            background: linear-gradient(to right, #888, red);
        `;
        const satHandle = document.createElement('div');
        satHandle.style.cssText = `
            position: absolute;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: white;
            border: 2px solid #d1d5db;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
            top: 50%;
            left: 100%;
            transform: translate(-50%,-50%);
        `;
        saturationSlider.appendChild(satHandle);

        // --- 미리보기 및 입력, 적용 버튼 ---
        const previewArea = document.createElement('div');
        previewArea.style.cssText = `display:flex; align-items:center; gap:8px; margin-bottom:10px;`;
        const colorPreview = document.createElement('div');
        colorPreview.style.cssText = `
            width: 28px;
            height: 28px;
            border-radius: 50%;
            box-shadow: 0 1px 6px rgba(0,0,0,0.15);
            flex-shrink: 0;
            background-color: #ff0000;
        `;
        const colorInput = document.createElement('input');
        colorInput.type = 'text';
        colorInput.value = '#ff0000';
        colorInput.style.cssText = `
            flex: 1;
            padding: 5px 0;
            padding-left:2px;
            background: #f9fafb;
            border: 1px solid #e5e7eb;
            border-radius: 6px;
            font-family: monospace;
            font-size: 12px;
            color: #1f2937;
            outline: none;
        `;
        previewArea.appendChild(colorPreview);
        previewArea.appendChild(colorInput);

        const applyButton = document.createElement('button');
        applyButton.textContent = '적용';
        applyButton.style.cssText = `
            width: 100%;
            padding: 8px;
            background: #3b82f6;
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
        `;

        // 요소 조립
        pickerContainer.appendChild(hueSlider);
        pickerContainer.appendChild(mainArea);
        pickerContainer.appendChild(saturationSlider);
        pickerContainer.appendChild(previewArea);
        pickerContainer.appendChild(applyButton);
        this.toolbar.appendChild(pickerContainer);

        // 캔버스 그리기
        function drawRainbowCanvas() {
            const rect = rainbowCanvas.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            rainbowCanvas.width = Math.round(rect.width * dpr);
            rainbowCanvas.height = Math.round(rect.height * dpr);
            rainbowCanvas.style.width = rect.width + 'px';
            rainbowCanvas.style.height = rect.height + 'px';
            const ctx = rainbowCanvas.getContext('2d');
            ctx.clearRect(0, 0, rainbowCanvas.width, rainbowCanvas.height);

            // hue gradient horizontally
            for (let x = 0; x < rainbowCanvas.width; x++) {
                const hue = (x / Math.max(1, (rainbowCanvas.width - 1))) * 360;
                ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
                ctx.fillRect(x, 0, 1, rainbowCanvas.height);
            }

            // 위에서 흰색 -> 투명
            let g1 = ctx.createLinearGradient(0, 0, 0, rainbowCanvas.height/2);
            g1.addColorStop(0, 'rgba(255,255,255,1)');
            g1.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g1;
            ctx.fillRect(0, 0, rainbowCanvas.width, rainbowCanvas.height/2);

            // 아래에서 투명 -> 검정
            let g2 = ctx.createLinearGradient(0, rainbowCanvas.height/2, 0, rainbowCanvas.height);
            g2.addColorStop(0, 'rgba(0,0,0,0)');
            g2.addColorStop(1, 'rgba(0,0,0,1)');
            ctx.fillStyle = g2;
            ctx.fillRect(0, rainbowCanvas.height/2, rainbowCanvas.width, rainbowCanvas.height/2);
        }

        function updateSaturationSlider() {
            const leftColor = `hsl(${currentHue}, 0%, ${currentLightness}%)`;
            const rightColor = `hsl(${currentHue}, 100%, ${currentLightness}%)`;
            saturationSlider.style.background = `linear-gradient(to right, ${leftColor}, ${rightColor})`;
            satHandle.style.left = `${currentSaturation}%`;
        }

        function updateLightnessSlider() {
            const topColor = `hsl(${currentHue}, ${currentSaturation}%, 100%)`;
            const bottomColor = `hsl(${currentHue}, ${currentSaturation}%, 0%)`;
            lightnessSlider.style.background = `linear-gradient(to bottom, ${topColor}, ${bottomColor})`;
            lightHandle.style.top = `${100 - currentLightness}%`;
        }

        function updateIndicators() {
            const xPercent = (currentHue / 360) * 100;
            const yPercent = (100 - currentLightness);
            mainIndicator.style.left = `${xPercent}%`;
            mainIndicator.style.top = `${yPercent}%`;
        }

        // --- 포인터(터치/마우스/펜) 기반 상호작용 처리 ---
        let draggingMain = false;
        let draggingSat = false;
        let draggingLight = false;
        let activePointerId = null;

        function handleMainMove(e) {
            const rect = rainbowCanvas.getBoundingClientRect();
            const clientX = e.clientX;
            const clientY = e.clientY;
            const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
            currentHue = Math.round(x * 360);
            currentLightness = Math.round((1 - y) * 100);
            updateColor();
            updateIndicators();
        }

        function handleSatMove(e) {
            const rect = saturationSlider.getBoundingClientRect();
            const clientX = e.clientX;
            const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            currentSaturation = Math.round(x * 100);
            updateColor();
            updateIndicators();
        }

        function handleLightMove(e) {
            const rect = lightnessSlider.getBoundingClientRect();
            const clientY = e.clientY;
            const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
            currentLightness = Math.round((1 - y) * 100);
            updateColor();
            updateIndicators();
        }

        // PointerEvent 사용
        if (window.PointerEvent) {
            // 캔버스
            rainbowCanvas.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                draggingMain = true;
                activePointerId = e.pointerId;
                try { rainbowCanvas.setPointerCapture(e.pointerId); } catch (err) {}
                handleMainMove(e);
            });
            rainbowCanvas.addEventListener('pointermove', (e) => {
                if (draggingMain && e.pointerId === activePointerId) handleMainMove(e);
            });
            rainbowCanvas.addEventListener('pointerup', (e) => {
                if (e.pointerId === activePointerId) {
                    draggingMain = false;
                    try { rainbowCanvas.releasePointerCapture(e.pointerId); } catch (err) {}
                    activePointerId = null;
                }
            });
            rainbowCanvas.addEventListener('pointercancel', () => { draggingMain = false; activePointerId = null; });

            // 채도 슬라이더
            saturationSlider.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                draggingSat = true;
                activePointerId = e.pointerId;
                try { saturationSlider.setPointerCapture(e.pointerId); } catch (err) {}
                handleSatMove(e);
            });
            satHandle.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                draggingSat = true;
                activePointerId = e.pointerId;
                try { satHandle.setPointerCapture(e.pointerId); } catch (err) {}
                handleSatMove(e);
            });
            document.addEventListener('pointermove', (e) => { if (draggingSat && e.pointerId === activePointerId) handleSatMove(e); });
            document.addEventListener('pointerup', (e) => {
                if (draggingSat && e.pointerId === activePointerId) {
                    draggingSat = false;
                    try { saturationSlider.releasePointerCapture(e.pointerId); } catch (err) {}
                    try { satHandle.releasePointerCapture(e.pointerId); } catch (err) {}
                    activePointerId = null;
                }
            });

            // 밝기 슬라이더
            lightnessSlider.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                draggingLight = true;
                activePointerId = e.pointerId;
                try { lightnessSlider.setPointerCapture(e.pointerId); } catch (err) {}
                handleLightMove(e);
            });
            lightHandle.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                draggingLight = true;
                activePointerId = e.pointerId;
                try { lightHandle.setPointerCapture(e.pointerId); } catch (err) {}
                handleLightMove(e);
            });
            document.addEventListener('pointermove', (e) => { if (draggingLight && e.pointerId === activePointerId) handleLightMove(e); });
            document.addEventListener('pointerup', (e) => {
                if (draggingLight && e.pointerId === activePointerId) {
                    draggingLight = false;
                    try { lightnessSlider.releasePointerCapture(e.pointerId); } catch (err) {}
                    try { lightHandle.releasePointerCapture(e.pointerId); } catch (err) {}
                    activePointerId = null;
                }
            });
        } else {
            // 구형 브라우저 폴백
            rainbowCanvas.addEventListener('mousedown', (e) => { draggingMain = true; handleMainMove(e); });
            document.addEventListener('mousemove', (e) => { if (draggingMain) handleMainMove(e); });
            document.addEventListener('mouseup', () => { draggingMain = false; });

            saturationSlider.addEventListener('mousedown', (e) => { draggingSat = true; handleSatMove(e); });
            satHandle.addEventListener('mousedown', (e) => { draggingSat = true; handleSatMove(e); });
            document.addEventListener('mousemove', (e) => { if (draggingSat) handleSatMove(e); });
            document.addEventListener('mouseup', () => { draggingSat = false; });

            lightnessSlider.addEventListener('mousedown', (e) => { draggingLight = true; handleLightMove(e); });
            lightHandle.addEventListener('mousedown', (e) => { draggingLight = true; handleLightMove(e); });
            document.addEventListener('mousemove', (e) => { if (draggingLight) handleLightMove(e); });
            document.addEventListener('mouseup', () => { draggingLight = false; });
        }

        // 색 입력 직접 입력 처리
        colorInput.addEventListener('input', () => {
            const hex = colorInput.value.trim();
            if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
                const hsl = hexToHsl(hex);
                currentHue = hsl.h;
                currentSaturation = hsl.s;
                currentLightness = hsl.l;
                drawRainbowCanvas();
                updateColor();
                updateIndicators();
            }
        });

        // 적용 버튼
        applyButton.addEventListener('click', () => {
            if (self.restoreSelection) self.restoreSelection();
            if (self.execCommand) self.execCommand(command, colorInput.value);
            closeModal();
            if (self.createUndoPoint) self.createUndoPoint();
        });

        // 모달 닫기
        function closeModal() {
            if (pickerContainer.parentNode) pickerContainer.parentNode.removeChild(pickerContainer);
            document.removeEventListener('mousedown', closeHandler);
            document.removeEventListener('keydown', handleEsc);
            window.removeEventListener('resize', resizeHandler);
            draggingMain = draggingSat = draggingLight = false;
            activePointerId = null;
        }

        const closeHandler = (e) => {
            if (!pickerContainer.contains(e.target) && e.target !== button) {
                closeModal();
            }
        };

        const handleEsc = (e) => {
            if (e.key === 'Escape') closeModal();
        };

        const resizeHandler = () => {
            requestAnimationFrame(() => {
                drawRainbowCanvas();
                updateIndicators();
                updateSaturationSlider();
                updateLightnessSlider();
            });
        };
        window.addEventListener('resize', resizeHandler);

        requestAnimationFrame(() => {
            document.addEventListener('mousedown', closeHandler);
            document.addEventListener('keydown', handleEsc);
        });

        function initialSetup() {
            drawRainbowCanvas();
            updateSaturationSlider();
            updateLightnessSlider();
            updateIndicators();
            updateColor();
        }
        requestAnimationFrame(initialSetup);

        // HSL <-> HEX 변환 함수 (내부 스코프)
        function hslToHex(h, s, l) {
            l /= 100;
            const a = s * Math.min(l, 1 - l) / 100;
            const f = n => {
                const k = (n + h / 30) % 12;
                const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
                return Math.round(255 * color).toString(16).padStart(2, '0');
            };
            return `#${f(0)}${f(8)}${f(4)}`;
        }
        function hexToHsl(hex) {
            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            if (!result) return { h: 0, s: 0, l: 0 };
            let r = parseInt(result[1], 16) / 255;
            let g = parseInt(result[2], 16) / 255;
            let b = parseInt(result[3], 16) / 255;
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            let h, s, l = (max + min) / 2;
            if (max === min) {
                h = s = 0;
            } else {
                const d = max - min;
                s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                switch (max) {
                    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
                    case g: h = ((b - r) / d + 2) / 6; break;
                    case b: h = ((r - g) / d + 4) / 6; break;
                }
            }
            return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
        }
    }

    toggleAlignment(button) {
        const alignments = ['left', 'center', 'right'];
        const commands = ['justifyLeft', 'justifyCenter', 'justifyRight'];
        const icons = ['format_align_left', 'format_align_center', 'format_align_right'];
        
        let currentIndex = alignments.indexOf(this.alignmentState);
        currentIndex = (currentIndex + 1) % alignments.length;
        
        this.alignmentState = alignments[currentIndex];
        button.querySelector('.material-icons').textContent = icons[currentIndex];
        
        const selection = window.getSelection();
        const range = selection.getRangeAt(0);
        const block = this.getClosestBlock(range.commonAncestorContainer);
        
        if (block) {
            block.style.textAlign = this.alignmentState;
        }
        
        this.execCommand(commands[currentIndex]);
        this.createUndoPoint();
    }

    showDropdown(element, button) {
        const buttonRect = button.getBoundingClientRect();
        const toolbarRect = this.toolbar.getBoundingClientRect();
        
        const dropdownContainer = document.createElement('div');
        dropdownContainer.style.cssText = `
            position: absolute;
            top: ${buttonRect.bottom - toolbarRect.top}px;
            left: ${buttonRect.left - toolbarRect.left}px;
            z-index: 10000;
        `;
        
        dropdownContainer.appendChild(element);
        this.toolbar.appendChild(dropdownContainer);
        
        const dropdownRect = element.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        
        if (dropdownRect.right > viewportWidth) {
            const overflow = dropdownRect.right - viewportWidth;
            dropdownContainer.style.left = `${parseInt(dropdownContainer.style.left) - overflow - 10}px`;
        }
        
        const closeHandler = (e) => {
            if (!element.contains(e.target) && e.target !== button) {
                dropdownContainer.remove();
                document.removeEventListener('mousedown', closeHandler);
            }
        };
        
        requestAnimationFrame(() => {
            document.addEventListener('mousedown', closeHandler);
        });
    }

    insertAtCursor(element) {
        const selection = window.getSelection();
        if (!selection.rangeCount) return;

        const range = selection.getRangeAt(0);
        let currentBlock = this.getClosestBlock(range.startContainer);

        if (!currentBlock || currentBlock === this.editor) {
            currentBlock = document.createElement('p');
            currentBlock.innerHTML = '<br>';
            this.editor.appendChild(currentBlock);
        }

        const wrapper = document.createElement('p');
        wrapper.appendChild(element);
        currentBlock.parentNode.insertBefore(wrapper, currentBlock.nextSibling);

        this.normalizeContent();
        this.createUndoPoint();
    }

    setContent(html) {
        if (!html) return;
        
        this.editor.innerHTML = html;
        
        const essentialPlugins = ['image', 'code', 'video', 'file', 'table'];
        const allLoaded = essentialPlugins.every(name => 
            this.pluginLoadStatus.get(name) === 'loaded'
        );
        
        if (allLoaded) {
            this.processContentSet(html);
        } else {
            console.log('Plugins not ready, queuing content initialization');
            this.contentSetQueue = html;
            
            setTimeout(() => {
                if (this.contentSetQueue) {
                    console.warn('Timeout: Processing content without all plugins');
                    this.processContentSet(this.contentSetQueue);
                    this.contentSetQueue = null;
                }
            }, 3000);
        }
    }

    processContentSet(html) {
        console.log('Processing content set with plugins');
        
        for (let [name, plugin] of this.plugins) {
            if (plugin.onContentSet) {
                try {
                    plugin.onContentSet(html);
                } catch (error) {
                    console.error(`Plugin ${name} onContentSet failed:`, error);
                }
            }
        }
        
        this.normalizeContent();
        
        setTimeout(() => {
            for (let [name, plugin] of this.plugins) {
                if (plugin.initializeImageBlocks) plugin.initializeImageBlocks();
                if (plugin.initializeCodeBlocks) plugin.initializeCodeBlocks();
                if (plugin.initializeVideoBlocks) plugin.initializeVideoBlocks();
                if (plugin.initializeFileBlocks) plugin.initializeFileBlocks();
                if (plugin.initializeTables) plugin.initializeTables();
                if (plugin.initializeDrawingBlocks) plugin.initializeDrawingBlocks();
            }
        }, 100);
    }

    registerPlugin(name, plugin) {
        this.plugins.set(name, plugin);
        
        if (name === 'collab') {
            this.collab = plugin;
        }
    }

    getPlugin(name) {
        return this.plugins.get(name);
    }

    generateUid() {
        const random = Math.floor(Math.random() * 1000000000);
        const timestamp = new Date().getTime();
        return `${random}${timestamp}`;
    }

    sanitizeHTML(html) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        
        const allowedTags = ['b', 'i', 'u', 's', 'strong', 'em', 'br', 'p', 'div', 'span', 'a', 'img', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
        const allowedAttributes = ['href', 'src', 'alt', 'title', 'style'];
        
        const cleanNode = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                return node;
            }
            
            if (node.nodeType === Node.ELEMENT_NODE) {
                const tagName = node.tagName.toLowerCase();
                
                if (!allowedTags.includes(tagName)) {
                    return document.createTextNode(node.textContent);
                }
                
                const attributes = Array.from(node.attributes);
                attributes.forEach(attr => {
                    if (!allowedAttributes.includes(attr.name)) {
                        node.removeAttribute(attr.name);
                    }
                });
                
                const childNodes = Array.from(node.childNodes);
                childNodes.forEach(child => {
                    const cleaned = cleanNode(child);
                    if (cleaned !== child) {
                        node.replaceChild(cleaned, child);
                    }
                });
            }
            
            return node;
        };
        
        const nodes = Array.from(tempDiv.childNodes);
        nodes.forEach((node, index) => {
            const cleaned = cleanNode(node);
            if (cleaned !== node) {
                tempDiv.replaceChild(cleaned, node);
            }
        });
        
        return tempDiv.innerHTML;
    }

    handleBulletPoints() {
        // 추후 구현
    }

    showButtonLoading(button) {
        if (!button || button.querySelector('.t2-btn-loading-overlay')) return;
        
        const overlay = document.createElement('div');
        overlay.className = 't2-btn-loading-overlay';
        
        const spinner = document.createElement('div');
        spinner.className = 't2-btn-loading-spinner';
        
        overlay.appendChild(spinner);
        button.appendChild(overlay);
        button.disabled = true;
    }

    hideButtonLoading(button) {
        if (!button) return;
        
        const overlay = button.querySelector('.t2-btn-loading-overlay');
        if (overlay) {
            overlay.remove();
        }
        button.disabled = false;
    }
}

window.T2Editor = T2Editor;