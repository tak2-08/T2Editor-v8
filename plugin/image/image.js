// T2Editor/plugin/image/image.js

class T2ImagePlugin {
    constructor(editor) {
        this.editor = editor;
        this.commands = ['insertImage'];
        this.config = null;
        this.uploadQueue = [];
        this.maxConcurrentUploads = 3;
        this.currentUploads = 0;
        this.maxRetries = 3;
        this.loadConfig();
    }

    async loadConfig() {
        try {
            const response = await fetch(`${t2editor_url}/config/get_upload_config.php`);
            this.config = await response.json();
        } catch (error) {
            console.error('Failed to load upload config:', error);
            this.config = {
                maxUploadSize: 50,
                allowedExtensions: {
                    image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico']
                },
                acceptStrings: {
                    image: '.jpg,.jpeg,.png,.gif,.webp,.bmp,.svg,.ico'
                }
            };
        }
    }

    handleCommand(command, button) {
        switch(command) {
            case 'insertImage':
                this.showImageUploadModal();
                break;
        }
    }

    onContentSet(html) {
        console.log('Image plugin: onContentSet called');
        setTimeout(() => {
            this.initializeImageBlocks();
        }, 50);
    }

    async handlePaste(e) {
        const clipboardData = e.clipboardData || window.clipboardData;
        if (!clipboardData) return false;
        
        let handled = false;
        
        if (clipboardData.items) {
            const imageFiles = [];
            
            for (let i = 0; i < clipboardData.items.length; i++) {
                const item = clipboardData.items[i];
                
                if (item.type.indexOf('image') !== -1) {
                    const file = item.getAsFile();
                    if (file) {
                        imageFiles.push(file);
                    }
                }
            }
            
            if (imageFiles.length > 0) {
                e.preventDefault();
                await this.handleMultipleImageInsert(imageFiles);
                handled = true;
            }
        }
        
        if (!handled) {
            const htmlData = clipboardData.getData('text/html');
            if (htmlData) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = htmlData;
                const images = tempDiv.querySelectorAll('img');
                
                if (images.length > 0) {
                    e.preventDefault();
                    await this.handlePastedImages(images);
                    handled = true;
                }
            }
        }
        
        return handled;
    }

    async handlePastedImages(images) {
        const imageDataArray = [];
        
        for (const img of images) {
            const src = img.src;
            const width = img.naturalWidth || parseInt(img.width) || 320;
            const height = img.naturalHeight || parseInt(img.height) || 180;
            
            if (src.startsWith('data:image/')) {
                try {
                    const blob = await this.dataURLtoBlob(src);
                    const file = new File([blob], 'pasted-image.png', { type: blob.type });
                    
                    const imageData = await this.processImageFile(file);
                    if (imageData) {
                        imageDataArray.push(imageData);
                    }
                } catch (error) {
                    console.error('Failed to process base64 image:', error);
                }
            } 
            else {
                const blockId = this.generateBlockId();
                imageDataArray.push({
                    url: src,
                    width: width,
                    height: height,
                    blockId: blockId,
                    isUploading: false
                });
            }
        }
        
        if (imageDataArray.length > 0) {
            this.insertImageBlocks(imageDataArray);
            
            imageDataArray.forEach(imageData => {
                if (imageData.file) {
                    this.queueUpload(imageData.file, imageData.blockId);
                }
            });
        }
    }

    dataURLtoBlob(dataURL) {
        return new Promise((resolve, reject) => {
            try {
                const arr = dataURL.split(',');
                const mime = arr[0].match(/:(.*?);/)[1];
                const bstr = atob(arr[1]);
                let n = bstr.length;
                const u8arr = new Uint8Array(n);
                while (n--) {
                    u8arr[n] = bstr.charCodeAt(n);
                }
                resolve(new Blob([u8arr], { type: mime }));
            } catch (error) {
                reject(error);
            }
        });
    }

    showImageUploadModal() {
        if (!this.config) {
            T2Utils.showNotification('설정을 불러오는 중입니다. 잠시 후 다시 시도해주세요.', 'warning');
            return;
        }

        const modalContent = `
            <div class="t2-image-editor-modal">
                <h3>이미지 추가</h3>
                <div class="t2-image-upload-area">
                    <span class="material-icons">cloud_upload</span>
                    <div class="t2-image-upload-text">클릭하여 이미지 선택</div>
                    <div class="t2-image-upload-hint">(또는 이미지를 여기로 드래그하세요)<br>최대 ${this.config.maxUploadSize}MB (최대 15개)</div>
                    <input type="file" name="bf_file[]" accept="${this.config.acceptStrings.image}" multiple>
                    <input type="hidden" name="uid" value="${this.editor.generateUid()}">
                </div>
                <div class="t2-preview-drag-hint">
                    <span class="material-icons">swap_horiz</span>
                    <span>이미지를 좌우로 드래그하여 순서를 변경할 수 있습니다</span>
                </div>
                <div class="t2-image-preview-grid"></div>
                <div class="t2-btn-group">
                    <button type="button" class="t2-btn" data-action="cancel">취소</button>
                    <button type="button" class="t2-btn" data-action="upload" disabled>추가</button>
                </div>
            </div>
        `;

        const modal = T2Utils.createModal(modalContent);
        this.setupModalEvents(modal);
    }

    setupModalEvents(modal) {
        const previewGrid = modal.querySelector('.t2-image-preview-grid');
        const fileInput = modal.querySelector('input[type="file"]');
        const uploadBtn = modal.querySelector('[data-action="upload"]');
        const uploadArea = modal.querySelector('.t2-image-upload-area');
        const dragHint = modal.querySelector('.t2-preview-drag-hint');
        
        const previewFiles = new Map();
        let draggedItem = null;
        let lastDragOverItem = null;

        const updateOrderNumbers = () => {
            const items = previewGrid.querySelectorAll('.t2-preview-item');
            items.forEach((item, index) => {
                const orderBadge = item.querySelector('.t2-preview-order');
                if (orderBadge) {
                    orderBadge.textContent = index + 1;
                }
            });
        };

        const showDragHint = () => {
            if (previewFiles.size > 1 && dragHint) {
                setTimeout(() => {
                    dragHint.classList.add('show');
                }, 100);
            }
        };

        const handleFiles = (files) => {
            const remainingSlots = 15 - previewFiles.size;
            const filesToProcess = Array.from(files).slice(0, remainingSlots);
            
            if (files.length > remainingSlots) {
                T2Utils.showNotification(`최대 15개까지만 업로드할 수 있습니다. ${filesToProcess.length}개만 추가됩니다.`, 'warning');
            }

            filesToProcess.forEach(file => {
                if (!this.validateImageFile(file)) {
                    return;
                }

                const reader = new FileReader();
                reader.onload = (e) => {
                    const previewItem = document.createElement('div');
                    previewItem.className = 't2-preview-item';
                    previewItem.draggable = true;
                    previewItem.innerHTML = `
                        <div class="t2-preview-order">${previewFiles.size + 1}</div>
                        <img src="${e.target.result}" alt="Preview">
                        <button type="button" class="t2-preview-remove">
                            <span class="material-icons">close</span>
                        </button>
                    `;

                    // 드래그 이벤트
                    previewItem.addEventListener('dragstart', (e) => {
                        draggedItem = previewItem;
                        previewItem.classList.add('dragging');
                        e.dataTransfer.effectAllowed = 'move';
                    });

                    previewItem.addEventListener('dragend', () => {
                        draggedItem = null;
                        previewItem.classList.remove('dragging');
                        if (lastDragOverItem) {
                            lastDragOverItem.classList.remove('drag-over');
                            lastDragOverItem = null;
                        }
                        updateOrderNumbers();
                    });

                    previewItem.addEventListener('dragover', (e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        
                        if (draggedItem && draggedItem !== previewItem) {
                            if (lastDragOverItem && lastDragOverItem !== previewItem) {
                                lastDragOverItem.classList.remove('drag-over');
                            }
                            previewItem.classList.add('drag-over');
                            lastDragOverItem = previewItem;
                            
                            const rect = previewItem.getBoundingClientRect();
                            const midpoint = rect.left + rect.width / 2;
                            
                            if (e.clientX < midpoint) {
                                previewGrid.insertBefore(draggedItem, previewItem);
                            } else {
                                previewGrid.insertBefore(draggedItem, previewItem.nextSibling);
                            }
                        }
                    });

                    previewItem.addEventListener('dragleave', () => {
                        previewItem.classList.remove('drag-over');
                    });

                    // 터치 이벤트 (모바일)
                    let touchStartX, touchStartY, isTouchDragging = false, touchDirection = null;
                    
                    previewItem.addEventListener('touchstart', (e) => {
                        const touch = e.touches[0];
                        touchStartX = touch.clientX;
                        touchStartY = touch.clientY;
                        isTouchDragging = false;
                        touchDirection = null;
                    });

                    previewItem.addEventListener('touchmove', (e) => {
                        const touch = e.touches[0];
                        const deltaX = Math.abs(touch.clientX - touchStartX);
                        const deltaY = Math.abs(touch.clientY - touchStartY);
                        
                        // 방향 결정 (처음 한 번만)
                        if (!touchDirection && (deltaX > 15 || deltaY > 15)) {
                            touchDirection = deltaX > deltaY ? 'horizontal' : 'vertical';
                        }
                        
                        // 수평 드래그만 처리 (수직은 스크롤)
                        if (touchDirection === 'horizontal' && deltaX > 30) {
                            isTouchDragging = true;
                            e.preventDefault();
                            
                            previewItem.classList.add('dragging');
                            
                            const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);
                            const targetItem = elementBelow?.closest('.t2-preview-item');
                            
                            if (targetItem && targetItem !== previewItem) {
                                if (lastDragOverItem && lastDragOverItem !== targetItem) {
                                    lastDragOverItem.classList.remove('drag-over');
                                }
                                targetItem.classList.add('drag-over');
                                lastDragOverItem = targetItem;
                                
                                const rect = targetItem.getBoundingClientRect();
                                const midpoint = rect.left + rect.width / 2;
                                
                                if (touch.clientX < midpoint) {
                                    previewGrid.insertBefore(previewItem, targetItem);
                                } else {
                                    previewGrid.insertBefore(previewItem, targetItem.nextSibling);
                                }
                            }
                        }
                    });

                    previewItem.addEventListener('touchend', () => {
                        previewItem.classList.remove('dragging');
                        if (lastDragOverItem) {
                            lastDragOverItem.classList.remove('drag-over');
                            lastDragOverItem = null;
                        }
                        if (isTouchDragging) {
                            updateOrderNumbers();
                        }
                        touchDirection = null;
                    });

                    const removeBtn = previewItem.querySelector('.t2-preview-remove');
                    removeBtn.onclick = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        previewFiles.delete(file);
                        previewItem.remove();
                        uploadBtn.disabled = previewFiles.size === 0;
                        updateOrderNumbers();
                        
                        if (previewFiles.size <= 1 && dragHint) {
                            dragHint.classList.remove('show');
                        }
                    };

                    previewFiles.set(file, previewItem);
                    previewGrid.appendChild(previewItem);
                    uploadBtn.disabled = false;
                    updateOrderNumbers();
                    showDragHint();
                };
                reader.readAsDataURL(file);
            });
        };

        fileInput.onchange = (e) => handleFiles(e.target.files);
        T2Utils.setupDragAndDrop(uploadArea, handleFiles);
        modal.querySelector('[data-action="cancel"]').onclick = () => modal.remove();

        modal.querySelector('[data-action="upload"]').onclick = () => {
            if (previewFiles.size > 0) {
                const orderedFiles = Array.from(previewGrid.querySelectorAll('.t2-preview-item')).map(item => {
                    for (const [file, element] of previewFiles.entries()) {
                        if (element === item) return file;
                    }
                }).filter(Boolean);
                
                this.handleMultipleImageInsert(orderedFiles);
            }
            modal.remove();
        };
    }

    validateImageFile(file) {
        if (!this.config) {
            T2Utils.showNotification('설정을 불러오는 중입니다.', 'warning');
            return false;
        }

        const fileExt = file.name.toLowerCase().split('.').pop();
        
        if (!this.config.allowedExtensions.image.includes(fileExt)) {
            T2Utils.showNotification('지원하지 않는 이미지 형식입니다.', 'error');
            return false;
        }
        
        const maxSize = this.config.maxUploadSize * 1024 * 1024;
        if (file.size > maxSize) {
            T2Utils.showNotification(`파일 크기가 너무 큽니다. (최대 ${this.config.maxUploadSize}MB)`, 'error');
            return false;
        }
        
        return true;
    }

    async processImageFile(file) {
        if (!this.validateImageFile(file)) {
            return null;
        }

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const base64Url = e.target.result;
                const img = new Image();
                
                img.onload = () => {
                    const blockId = this.generateBlockId();
                    const imageData = {
                        url: base64Url,
                        width: img.naturalWidth,
                        height: img.naturalHeight,
                        blockId: blockId,
                        isUploading: true,
                        file: file
                    };
                    resolve(imageData);
                };
                
                img.onerror = () => reject(new Error('이미지 로드 실패'));
                img.src = base64Url;
            };
            
            reader.onerror = () => reject(new Error('파일 읽기 실패'));
            reader.readAsDataURL(file);
        });
    }

    async handleMultipleImageInsert(files) {
        try {
            const imageDataArray = await Promise.all(
                files.map(file => this.processImageFile(file))
            );
            
            const validImages = imageDataArray.filter(data => data !== null);
            
            if (validImages.length > 0) {
                this.insertImageBlocks(validImages);
                
                validImages.forEach(imageData => {
                    this.queueUpload(imageData.file, imageData.blockId);
                });
            }
        } catch (error) {
            console.error('Multiple image insert error:', error);
            T2Utils.showNotification('일부 이미지 처리에 실패했습니다.', 'error');
        }
    }

    queueUpload(file, blockId, retryCount = 0) {
        this.uploadQueue.push({ file, blockId, retryCount });
        this.processUploadQueue();
    }

    async processUploadQueue() {
        if (this.currentUploads >= this.maxConcurrentUploads || this.uploadQueue.length === 0) {
            return;
        }

        const uploadTask = this.uploadQueue.shift();
        this.currentUploads++;

        try {
            await this.uploadToServer(uploadTask.file, uploadTask.blockId);
        } catch (error) {
            console.error('Upload failed:', error);
            
            if (uploadTask.retryCount < this.maxRetries) {
                T2Utils.showNotification(`업로드 재시도 중... (${uploadTask.retryCount + 1}/${this.maxRetries})`, 'info');
                uploadTask.retryCount++;
                this.uploadQueue.unshift(uploadTask);
            } else {
                T2Utils.showNotification('이미지 업로드에 실패했습니다.', 'error');
                this.markUploadFailed(uploadTask.blockId);
            }
        } finally {
            this.currentUploads--;
            this.processUploadQueue();
        }
    }

    async uploadToServer(file, blockId) {
        const formData = new FormData();
        formData.append('bf_file[]', file);
        formData.append('uid', this.editor.generateUid());

        const response = await fetch(`${t2editor_url}/plugin/image/image_upload.php`, {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.success && data.files.length > 0) {
            this.updateImageBlock(blockId, data.files[0]);
        } else {
            throw new Error(data.message || '업로드 실패');
        }
    }

    updateImageBlock(blockId, fileData) {
        const block = this.editor.editor.querySelector(`[data-block-id="${blockId}"]`);
        if (!block) return;

        const img = block.querySelector('img');
        if (img) {
            img.src = fileData.url;
            img.dataset.width = fileData.width;
            img.dataset.height = fileData.height;
        }

        block.removeAttribute('data-uploading');
        
        const uploadIndicator = block.querySelector('.t2-upload-indicator');
        if (uploadIndicator) {
            uploadIndicator.remove();
        }
    }

    markUploadFailed(blockId) {
        const block = this.editor.editor.querySelector(`[data-block-id="${blockId}"]`);
        if (!block) return;

        block.setAttribute('data-upload-failed', 'true');
        
        const uploadIndicator = block.querySelector('.t2-upload-indicator');
        if (uploadIndicator) {
            uploadIndicator.innerHTML = '<span class="material-icons" style="color: #f44336;">error</span>';
        }
    }

    insertImageBlocks(files) {
        const selection = window.getSelection();
        const range = selection.getRangeAt(0);
        const currentBlock = this.editor.getClosestBlock(range.startContainer);
        
        if (currentBlock && currentBlock !== this.editor.editor) {
            const topBreak = document.createElement('p');
            if (this.editor.isIOS || this.editor.isSafari) {
                topBreak.innerHTML = '<br>';
            } else {
                topBreak.innerHTML = '\u200B<br>';
            }
            currentBlock.parentNode.insertBefore(topBreak, currentBlock.nextSibling);
            
            let lastElement = topBreak;
            
            files.forEach((file, index) => {
                const mediaBlock = this.createImageBlock(file);
                
                lastElement.parentNode.insertBefore(mediaBlock, lastElement.nextSibling);
                lastElement = mediaBlock;
                
                if (index < files.length - 1) {
                    const breakLine = document.createElement('p');
                    breakLine.textContent = '\u200B';
                    lastElement.parentNode.insertBefore(breakLine, lastElement.nextSibling);
                    lastElement = breakLine;
                }
            });
            
            const bottomBreak = document.createElement('p');
            bottomBreak.textContent = '\u200B';
            lastElement.parentNode.insertBefore(bottomBreak, lastElement.nextSibling);
            
            files.forEach((file, index) => {
                const blocks = this.editor.editor.querySelectorAll('.t2-media-block');
                if (blocks[blocks.length - files.length + index]) {
                    this.cleanupEmptyLines(blocks[blocks.length - files.length + index]);
                }
            });
            
            const newRange = document.createRange();
            newRange.setStartAfter(bottomBreak);
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);
            
            this.editor.createUndoPoint();
            this.editor.autoSave();
        }
    }

    createImageBlock(file) {
        const mediaBlock = document.createElement('div');
        mediaBlock.className = 't2-media-block';
        mediaBlock.contentEditable = false;
        mediaBlock.style.position = 'relative';
        
        const blockId = file.blockId || this.generateBlockId();
        mediaBlock.setAttribute('data-block-id', blockId);
        
        if (file.isUploading) {
            mediaBlock.setAttribute('data-uploading', 'true');
        }
        
        const container = document.createElement('div');
        container.style.width = file.width + 'px';
        container.style.maxWidth = '100%';
        container.style.margin = '0 auto';
        container.style.position = 'relative';
        
        container.dataset.originalWidth = file.width;
        container.dataset.originalHeight = file.height;
        
        const img = document.createElement('img');
        img.src = file.url;
        img.style.width = '100%';
        img.dataset.width = file.width;
        img.dataset.height = file.height;
        
        container.appendChild(img);
        
        if (file.isUploading) {
            const uploadIndicator = document.createElement('div');
            uploadIndicator.className = 't2-upload-indicator';
            uploadIndicator.style.cssText = `
                position: absolute;
                top: 10px;
                right: 10px;
                background: rgba(0, 0, 0, 0.7);
                color: white;
                padding: 5px 10px;
                border-radius: 4px;
                font-size: 12px;
                display: flex;
                align-items: center;
                gap: 5px;
            `;
            uploadIndicator.innerHTML = `
                <span class="material-icons" style="font-size: 14px; animation: spin 1s linear infinite;">sync</span>
                <span>업로드 중...</span>
            `;
            container.appendChild(uploadIndicator);
            
            const style = document.createElement('style');
            style.textContent = `
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `;
            if (!document.querySelector('style[data-t2-spin]')) {
                style.setAttribute('data-t2-spin', 'true');
                document.head.appendChild(style);
            }
        }
        
        mediaBlock.appendChild(container);
        
        const controls = this.createMediaControls(container, img, blockId);
        mediaBlock.appendChild(controls);
        
        const moveControls = this.createMoveControls();
        mediaBlock.appendChild(moveControls);
        
        return mediaBlock;
    }

    createMediaControls(container, mediaElement, blockId) {
        const controls = document.createElement('div');
        controls.className = 't2-media-controls';
        controls.contentEditable = false;

        const width = parseInt(mediaElement.dataset.width) || parseInt(container.style.width) || 320;
        const height = parseInt(mediaElement.dataset.height) || parseInt(container.style.height) || 180;
        
        const editorWidth = this.editor.editor.clientWidth;
        const maxWidthPercentage = Math.min(100, Math.floor((editorWidth / width) * 100));
        
        const currentWidth = parseInt(container.style.width) || width;
        const percentage = container.dataset.sliderPercentage || Math.round((currentWidth / width) * 100);

        controls.innerHTML = `
            <button class="t2-btn delete-btn" type="button">
                <span class="material-icons">delete</span>
            </button>
            <input type="range" min="30" max="${maxWidthPercentage}" value="${percentage}" class="size-slider" style="width: 100px;">
        `;

        const sizeSlider = controls.querySelector('.size-slider');
        if (sizeSlider) {
            const resizeObserver = new ResizeObserver(() => {
                const newEditorWidth = this.editor.editor.clientWidth;
                const newMaxPercentage = Math.min(100, Math.floor((newEditorWidth / width) * 100));
                sizeSlider.max = newMaxPercentage;
                
                if (parseInt(sizeSlider.value) > newMaxPercentage) {
                    sizeSlider.value = newMaxPercentage;
                    const newWidth = Math.round((width * newMaxPercentage) / 100);
                    container.style.width = `${newWidth}px`;
                    container.style.maxWidth = '100%';
                    mediaElement.style.width = '100%';
                    container.dataset.sliderPercentage = newMaxPercentage;
                }
            });
            
            resizeObserver.observe(this.editor.editor);

            let isSliding = false;
            let slideTimer = null;

            sizeSlider.addEventListener('mousedown', () => {
                isSliding = true;
            });

            sizeSlider.addEventListener('mouseup', () => {
                isSliding = false;
                if (this.editor.getPlugin('collab')) {
                    this.editor.getPlugin('collab')._debounceUpdate();
                }
            });

            sizeSlider.addEventListener('input', (e) => {
                const percentage = parseInt(e.target.value);
                const newWidth = Math.round((width * percentage) / 100);
                
                container.style.width = `${newWidth}px`;
                container.style.maxWidth = '100%';
                mediaElement.style.width = '100%';
                container.dataset.sliderPercentage = percentage;

                if (isSliding) {
                    if (slideTimer) clearTimeout(slideTimer);
                    slideTimer = setTimeout(() => {
                        if (this.editor.getPlugin('collab')) {
                            this.editor.getPlugin('collab')._debounceUpdate();
                        }
                    }, 300);
                }
            });

            const updateSliderFromDOM = () => {
                const currentPercentage = container.dataset.sliderPercentage;
                if (currentPercentage && parseInt(sizeSlider.value) !== parseInt(currentPercentage)) {
                    sizeSlider.value = currentPercentage;
                }
            };

            setInterval(updateSliderFromDOM, 100);
        }

        const deleteBtn = controls.querySelector('.delete-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const mediaBlock = controls.closest('.t2-media-block');
                if (mediaBlock) {
                    mediaBlock.remove();
                    this.editor.createUndoPoint();
                    this.editor.autoSave();
                    
                    if (this.editor.getPlugin('collab')) {
                        this.editor.getPlugin('collab')._debounceUpdate();
                    }
                }
            });
        }

        return controls;
    }

    createMoveControls() {
        const moveWrapper = document.createElement('div');
        moveWrapper.className = 't2-move-controls';
        moveWrapper.contentEditable = false;
        moveWrapper.style.cssText = `
            position: absolute;
            bottom: 8px;
            right: 8px;
            display: inline-flex;
            background: rgba(50, 50, 50, 0.9);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0,0,0,0.4);
            z-index: 10;
        `;

        moveWrapper.innerHTML = `
            <button class="t2-btn t2-move-btn" type="button" data-direction="up" 
                style="padding: 6px 12px; border: none; border-radius: 0; border-right: 2px solid rgba(255,255,255,0.3); background: transparent; color: white; transition: all 0.2s; cursor: pointer;">
                <span class="material-icons" style="font-size: 20px;">arrow_upward</span>
            </button>
            <button class="t2-btn t2-move-btn" type="button" data-direction="down"
                style="padding: 6px 12px; border: none; border-radius: 0; background: transparent; color: white; transition: all 0.2s; cursor: pointer;">
                <span class="material-icons" style="font-size: 20px;">arrow_downward</span>
            </button>
        `;

        const upBtn = moveWrapper.querySelector('[data-direction="up"]');
        const downBtn = moveWrapper.querySelector('[data-direction="down"]');

        [upBtn, downBtn].forEach(btn => {
            btn.addEventListener('mouseenter', () => {
                btn.style.background = 'rgba(255,255,255,0.15)';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.background = 'transparent';
            });
        });

        upBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.moveBlock('up', moveWrapper);
        });

        downBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.moveBlock('down', moveWrapper);
        });

        return moveWrapper;
    }

    moveBlock(direction, controlElement) {
        const mediaBlock = controlElement.closest('.t2-media-block');
        if (!mediaBlock) return;

        const sibling = direction === 'up' ? mediaBlock.previousElementSibling : mediaBlock.nextElementSibling;
        
        if (!sibling) return;

        if (direction === 'up') {
            mediaBlock.parentNode.insertBefore(mediaBlock, sibling);
        } else {
            mediaBlock.parentNode.insertBefore(mediaBlock, sibling.nextElementSibling);
        }

        this.editor.createUndoPoint();
        this.editor.autoSave();
        
        if (this.editor.getPlugin('collab')) {
            this.editor.getPlugin('collab')._debounceUpdate();
        }
    }

    cleanupEmptyLines(imageBlock) {
        let prev = imageBlock.previousElementSibling;
        let emptyCount = 0;
        const toRemove = [];
        
        while (prev && prev.tagName === 'P' && 
               !prev.textContent.trim() && 
               (prev.innerHTML === '<br>' || prev.querySelector('br'))) {
            emptyCount++;
            if (emptyCount > 1) {
                toRemove.push(prev);
            }
            prev = prev.previousElementSibling;
        }
        
        let next = imageBlock.nextElementSibling;
        emptyCount = 0;
        
        while (next && next.tagName === 'P' && 
               !next.textContent.trim() && 
               (next.innerHTML === '<br>' || next.querySelector('br'))) {
            emptyCount++;
            if (emptyCount > 1) {
                toRemove.push(next);
            }
            next = next.nextElementSibling;
        }
        
        toRemove.forEach(el => el.remove());
    }

    initializeImageBlocks() {
        console.log('Initializing image blocks...');
        
        this.editor.editor.querySelectorAll('img:not(.t2-media-block img)').forEach(img => {
            const width = parseInt(img.style.width) || img.naturalWidth || 320;
            const height = parseInt(img.style.height) || img.naturalHeight || 180;
            
            const mediaBlock = this.createImageBlock({
                url: img.src,
                width: width,
                height: height
            });
            
            img.parentNode.replaceChild(mediaBlock, img);
            this.cleanupEmptyLines(mediaBlock);
        });

        this.editor.editor.querySelectorAll('.t2-media-block').forEach(block => {
            if (block.querySelector('iframe, video')) return;
            
            const container = block.querySelector('div:first-child');
            const mediaElement = container?.querySelector('img');
            
            if (mediaElement) {
                block.contentEditable = false;
                block.style.position = 'relative';
                
                if (!block.getAttribute('data-block-id')) {
                    block.setAttribute('data-block-id', this.generateBlockId());
                }
                
                const currentWidth = parseInt(container.style.width) || 320;
                const currentHeight = parseInt(container.style.height) || 180;
                
                if (!container.style.maxWidth) {
                    container.style.maxWidth = '100%';
                }
                if (!container.style.margin) {
                    container.style.margin = '0 auto';
                }
                
                mediaElement.style.width = '100%';
                
                if (!container.dataset.originalWidth) {
                    container.dataset.originalWidth = mediaElement.dataset.width || currentWidth;
                }
                if (!container.dataset.originalHeight) {
                    container.dataset.originalHeight = mediaElement.dataset.height || currentHeight;
                }
                
                if (block.parentNode.nodeName === 'P') {
                    const p = block.parentNode;
                    p.parentNode.insertBefore(block, p);
                    p.remove();
                }
                
                const existingControls = block.querySelector('.t2-media-controls');
                if (existingControls) {
                    existingControls.remove();
                }
                const controls = this.createMediaControls(
                    container, 
                    mediaElement, 
                    block.getAttribute('data-block-id')
                );
                block.appendChild(controls);
                
                const existingMoveControls = block.querySelector('.t2-move-controls');
                if (existingMoveControls) {
                    existingMoveControls.remove();
                }
                const moveControls = this.createMoveControls();
                block.appendChild(moveControls);
                
                this.cleanupEmptyLines(block);
            }
        });
        
        console.log('Image blocks initialization complete');
    }

    generateBlockId() {
        return `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

window.T2ImagePlugin = T2ImagePlugin;