// PawPrints — Main App Controller (Redesigned Flow)

const APP = {
    currentScreen: 'upload',
    productType: null,          // 'statue' or 'keyring'
    uploadedFile: null,
    previewUrl: null,
    modelUrl: null,
    selectedMaterial: null,     // 'bronze' or 'resin' — chosen at material preview step
    selectedHeight: 150,
    price: null,
    email: null,
    remaining: 3,
    uploadPath: null,           // original upload server path
    processedPath: null,        // path used for 3D generation (material preview image)
    processedImage: null,       // URL of chosen material image
    meshyTaskId: null,
    shapewaysModelId: null,
    shapewaysQuotes: null,
    _shapewaysBronzeCost: null,
    multiviewImages: [],
    // Material preview data
    materialPreviews: null,     // { original: {url}, bronze: {url, path}, resin: {url, path} }
    quoteLoaded: false,
};

// ─── Navigation ───
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(`screen-${screenId}`);
    if (el) el.classList.add('active');
    APP.currentScreen = screenId;

    const flow = ['upload', 'product', 'material', 'multiview', 'generating', 'customise', 'order', 'success'];
    const idx = flow.indexOf(screenId);
    // Map to 6 dots
    const dotMap = { upload: 0, product: 1, material: 2, multiview: 3, generating: 4, customise: 4, order: 5, success: 5 };
    const dotIdx = dotMap[screenId] ?? idx;
    document.querySelectorAll('.step-dot').forEach((d, i) => {
        d.className = 'step-dot';
        if (i < dotIdx) d.classList.add('done');
        if (i === dotIdx) d.classList.add('active');
    });

    const labels = {
        upload: 'Step 1 of 6', product: 'Step 2 of 6', material: 'Step 3 of 6',
        multiview: 'Step 4 of 6', generating: 'Step 5 of 6', customise: 'Step 5 of 6',
        order: 'Step 6 of 6', success: '✓ Complete'
    };
    document.getElementById('nav-step').textContent = labels[screenId] || '';
    document.getElementById('nav-back').style.display = idx > 0 ? '' : 'none';
    window.scrollTo(0, 0);
}

function goBack() {
    const flow = ['upload', 'product', 'material', 'multiview', 'customise', 'order'];
    const idx = flow.indexOf(APP.currentScreen);
    if (idx > 0) showScreen(flow[idx - 1]);
}

// ─── Screen 1: Upload Photo ───
function triggerCamera() {
    document.getElementById('camera-input').click();
}

function triggerGallery() {
    document.getElementById('file-input').click();
}

function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    APP.uploadedFile = file;
    APP.previewUrl = URL.createObjectURL(file);

    const img = document.getElementById('upload-preview-img');
    const container = document.getElementById('upload-preview');
    img.src = APP.previewUrl;
    container.style.display = 'block';
    document.getElementById('upload-prompt-area').style.display = 'none';
    document.querySelector('.upload-btns').style.display = 'none';
    checkUploadReady();
}

function removePhoto() {
    APP.uploadedFile = null;
    APP.previewUrl = null;
    document.getElementById('upload-preview').style.display = 'none';
    document.getElementById('upload-prompt-area').style.display = '';
    document.querySelector('.upload-btns').style.display = '';
    document.getElementById('file-input').value = '';
    document.getElementById('camera-input').value = '';
    checkUploadReady();
}

function checkUploadReady() {
    document.getElementById('btn-continue-upload').disabled = !APP.uploadedFile;
}

// File input listeners
document.getElementById('file-input').addEventListener('change', e => {
    if (e.target.files.length) handleFile(e.target.files[0]);
});
document.getElementById('camera-input').addEventListener('change', e => {
    if (e.target.files.length) handleFile(e.target.files[0]);
});

// Move to product selection
function goToProduct() {
    if (!APP.uploadedFile) return;
    // Show pet photo on product screen
    document.getElementById('product-pet-img').src = APP.previewUrl;
    showScreen('product');
}

// ─── Screen 2: Product Selection ───
function selectProduct(type) {
    APP.productType = type;
    document.querySelectorAll('.product-card').forEach(c => c.classList.remove('selected'));
    document.getElementById(`card-${type}`).classList.add('selected');
    document.getElementById('btn-continue-product').disabled = false;
}

function goToSignInThenMaterial() {
    if (!APP.productType) return;

    // Require sign-in, then upload photo and generate material previews
    requireAuth(async () => {
        APP.email = currentUser.email;

        showProcessing('Uploading your photo...', 'This will take a moment');

        try {
            // Register email for rate limiting
            const regRes = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: currentUser.email }),
            });
            if (regRes.ok) {
                const regData = await regRes.json();
                APP.remaining = regData.remaining;
            }

            // Upload the photo
            setProgress(10);
            const formData = new FormData();
            formData.append('file', APP.uploadedFile);
            const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
            if (!uploadRes.ok) throw new Error('Upload failed');
            const uploadData = await uploadRes.json();
            APP.uploadPath = uploadData.path;

            setProgress(25);
            document.getElementById('processing-text').textContent = 'Generating material previews...';
            document.getElementById('processing-sub').textContent = 'Creating bronze and resin versions of your pet';

            // Generate material previews
            const matRes = await fetch('/api/generate-material-previews', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    image_path: uploadData.path,
                    product_type: APP.productType,
                }),
            });
            if (!matRes.ok) {
                const err = await matRes.json();
                throw new Error(err.detail || 'Material preview generation failed');
            }
            const matData = await matRes.json();
            APP.materialPreviews = matData;

            setProgress(100);
            hideProcessing();

            // Show material preview screen
            initMaterialPreview();
            showScreen('material');

        } catch (err) {
            hideProcessing();
            console.error(err);
            alert('Failed: ' + err.message);
        }
    });
}

// ─── Screen 3: Material Preview ───
function initMaterialPreview() {
    const previews = APP.materialPreviews;
    if (!previews) return;

    const mainImg = document.getElementById('material-main-img');
    const thumbsContainer = document.getElementById('material-thumbs');
    thumbsContainer.innerHTML = '';

    // Determine which images we have
    const images = [];
    if (previews.original) {
        images.push({ key: 'original', label: '📸 Original', url: previews.original.url });
    }
    if (previews.bronze) {
        images.push({ key: 'bronze', label: '🥉 Bronze', url: previews.bronze.url });
    }
    if (previews.resin) {
        images.push({ key: 'resin', label: '🎨 Resin', url: previews.resin.url });
    }

    // Show first available preview in main window (bronze preferred)
    const defaultImg = images.find(i => i.key === 'bronze') || images[0];
    if (defaultImg) {
        mainImg.src = defaultImg.url + '?t=' + Date.now();
    }

    // Create thumbnails
    images.forEach((img, idx) => {
        const thumb = document.createElement('div');
        thumb.className = 'material-thumb' + (img.key === (defaultImg?.key) ? ' active' : '');
        thumb.dataset.key = img.key;
        thumb.innerHTML = `
            <img src="${img.url}?t=${Date.now()}" alt="${img.label}">
            <div class="material-thumb-label">${img.label}</div>
        `;
        thumb.addEventListener('click', () => {
            mainImg.src = img.url + '?t=' + Date.now();
            thumbsContainer.querySelectorAll('.material-thumb').forEach(t => t.classList.remove('active'));
            thumb.classList.add('active');
        });
        thumbsContainer.appendChild(thumb);
    });

    // Show/hide choose buttons based on availability
    document.getElementById('btn-choose-bronze').style.display = previews.bronze ? '' : 'none';
    document.getElementById('btn-choose-resin').style.display = previews.resin ? '' : 'none';
}

function chooseMaterial(material) {
    APP.selectedMaterial = material;
    const preview = APP.materialPreviews[material];
    if (preview) {
        APP.processedImage = preview.url;
        APP.processedPath = preview.path;
    }

    // Now generate multiview for the chosen material
    startMultiview();
}

// ─── Screen 4: Multi-View Review ───
async function startMultiview() {
    if (!APP.processedPath) {
        alert('No processed image found — please go back and try again.');
        return;
    }

    showProcessing('Generating views...', 'Creating front, side & back angles of your ' + APP.selectedMaterial + ' keepsake');

    try {
        setProgress(10);
        const res = await fetch('/api/generate-multiview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                processed_path: APP.processedPath,
                product_type: APP.productType,
                material: APP.selectedMaterial,
            }),
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Multi-view generation failed');
        }

        setProgress(80);
        const data = await res.json();
        APP.multiviewImages = data.views;

        setProgress(100);
        hideProcessing();

        renderMultiviewGrid();
        initMultiviewConfirmations();
        showScreen('multiview');

    } catch (err) {
        hideProcessing();
        console.error(err);
        alert('Multi-view generation failed: ' + err.message);
    }
}

function renderMultiviewGrid() {
    const grid = document.getElementById('multiview-grid');
    grid.innerHTML = '';

    // Material label
    document.getElementById('multiview-material-label').textContent = APP.selectedMaterial;

    // Original processed image first
    const origCard = document.createElement('div');
    origCard.className = 'multiview-card multiview-original';
    origCard.innerHTML = `
        <img src="${APP.processedImage}?t=${Date.now()}" alt="Chosen material">
        <div class="multiview-label">📸 ${APP.selectedMaterial === 'bronze' ? 'Bronze' : 'Resin'} Preview</div>
    `;
    grid.appendChild(origCard);

    // Generated views
    APP.multiviewImages.forEach(view => {
        const card = document.createElement('div');
        card.className = 'multiview-card';
        card.innerHTML = `
            <img src="${view.url}?t=${Date.now()}" alt="${view.label} view">
            <div class="multiview-label">${view.label} view</div>
        `;
        grid.appendChild(card);
    });
}

function initMultiviewConfirmations() {
    // Show/hide eyelet checkbox based on product type
    const eyeletLabel = document.getElementById('eyelet-check-label');
    if (APP.productType === 'keyring') {
        eyeletLabel.style.display = '';
    } else {
        eyeletLabel.style.display = 'none';
    }

    // Reset checkboxes
    document.getElementById('check-resemblance').checked = false;
    const eyeletCheck = document.getElementById('check-eyelet');
    if (eyeletCheck) eyeletCheck.checked = false;

    checkMultiviewReady();
}

function checkMultiviewReady() {
    const resemblance = document.getElementById('check-resemblance').checked;
    const eyelet = document.getElementById('check-eyelet');
    const isKeyring = APP.productType === 'keyring';

    let ready = resemblance;
    if (isKeyring && eyelet) {
        ready = ready && eyelet.checked;
    }

    document.getElementById('btn-confirm-multiview').disabled = !ready;
}

async function rerollMultiview() {
    showProcessing('Regenerating views...', 'Creating new angles');
    try {
        setProgress(10);
        const res = await fetch('/api/generate-multiview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                processed_path: APP.processedPath,
                product_type: APP.productType,
                material: APP.selectedMaterial,
            }),
        });

        if (!res.ok) throw new Error('Reroll failed');

        setProgress(80);
        const data = await res.json();
        APP.multiviewImages = data.views;

        setProgress(100);
        hideProcessing();
        renderMultiviewGrid();
        initMultiviewConfirmations();
    } catch (err) {
        hideProcessing();
        alert('Regeneration failed: ' + err.message);
    }
}

// ─── Confirm Modal ───
function showConfirmModal() {
    const confirmPreview = document.getElementById('confirm-img');
    confirmPreview.src = APP.processedImage;
    document.getElementById('confirm-modal').classList.add('active');
}

function hideConfirmModal() {
    document.getElementById('confirm-modal').classList.remove('active');
}

function confirmGenerate() {
    hideConfirmModal();
    startGenerating();
}

// ─── Screen 5: Generating (with testimonials) ───
async function startGenerating() {
    // Show the generating screen with testimonials
    showScreen('generating');
    setGeneratingProgress(5);
    document.getElementById('generating-status').textContent = 'Starting 3D generation...';

    try {
        // Build generation request
        const genBody = { processed_path: APP.processedPath };
        if (APP.multiviewImages && APP.multiviewImages.length > 0) {
            genBody.multiview_paths = [
                APP.processedPath,
                ...APP.multiviewImages.map(v => v.path),
            ];
        }

        const genRes = await fetch('/api/generate-3d', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(genBody),
        });

        if (!genRes.ok) {
            const err = await genRes.json();
            throw new Error(err.detail || 'Generation failed');
        }

        const genData = await genRes.json();
        if (genData.remaining !== undefined) APP.remaining = genData.remaining;

        if (genData.task_id) {
            APP.meshyTaskId = genData.task_id;
            const result = await pollModelStatusOnScreen(genData.task_id);
            if (result && result.shapeways_model_id) {
                APP.shapewaysModelId = result.shapeways_model_id;
            }
        } else if (genData.model_url) {
            APP.modelUrl = genData.model_url;
        }

        // Save model to user account
        if (typeof saveModel === 'function') {
            saveModel({
                modelUrl: APP.modelUrl,
                processedImage: APP.processedImage,
                processedPath: APP.processedPath,
                sourceImage: APP.previewUrl,
                productType: APP.productType,
                material: APP.selectedMaterial,
                meshyTaskId: APP.meshyTaskId,
                multiviewImages: APP.multiviewImages || [],
                date: new Date().toLocaleDateString(),
            });
        }

        // Move to customise
        initCustomise();
        showScreen('customise');

        // Fetch Shapeways quote in background for statues
        if (APP.meshyTaskId && APP.productType !== 'keyring') {
            fetchShapewaysQuoteWithRetry(APP.meshyTaskId);
        }

    } catch (err) {
        console.error(err);
        if (err.message.includes('limit')) {
            alert(err.message);
            showScreen('multiview');
            return;
        }
        // Fallback
        APP.modelUrl = '/static/model.glb';
        initCustomise();
        showScreen('customise');
    }
}

function setGeneratingProgress(pct) {
    document.getElementById('generating-progress-fill').style.width = pct + '%';
}

async function pollModelStatusOnScreen(taskId) {
    for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const progress = 10 + Math.min(i * 0.75, 85);
        setGeneratingProgress(progress);
        try {
            const res = await fetch(`/api/model-status/${taskId}`);
            const data = await res.json();
            if (data.status === 'completed') {
                APP.modelUrl = data.model_url;
                setGeneratingProgress(100);
                document.getElementById('generating-status').textContent = 'Model complete! Loading...';
                return data;
            }
            if (data.status === 'failed') throw new Error('Generation failed');
            document.getElementById('generating-status').textContent =
                `Generating... ${data.progress || Math.round(progress)}%`;
        } catch (e) {
            if (e.message === 'Generation failed') throw e;
        }
    }
    throw new Error('Timeout');
}

// ─── Processing Overlay (for quick operations) ───
function showProcessing(title, sub) {
    document.getElementById('processing-text').textContent = title;
    document.getElementById('processing-sub').textContent = sub;
    document.getElementById('processing-overlay').classList.add('active');
    setProgress(0);
}

function hideProcessing() {
    document.getElementById('processing-overlay').classList.remove('active');
}

function setProgress(pct) {
    document.getElementById('progress-fill').style.width = pct + '%';
}

// ─── Screen 6: Customise ───
function initCustomise() {
    const modelUrl = APP.modelUrl || '/static/model.glb';
    const container = document.getElementById('viewer-3d');
    const existingCanvas = container.querySelector('canvas');
    if (existingCanvas) existingCanvas.remove();

    initViewer('viewer-3d');
    loadModel(modelUrl);

    // Set product label
    document.getElementById('product-label').textContent =
        APP.productType === 'keyring' ? '🔑 Keyring' : '🗿 Statue';

    // Set material badge
    const matLabel = APP.selectedMaterial === 'resin' ? 'Full Colour Resin' : 'Bronze';
    document.getElementById('material-badge').textContent = `Material: ${matLabel}`;

    const isKeyring = APP.productType === 'keyring';
    const sizeCard = document.getElementById('size-card');

    if (isKeyring) {
        // Keyring: NO size options, NO material grid, NO finish
        APP.selectedHeight = 50;
        sizeCard.style.display = 'none';
    } else {
        // Statue: show size slider with max = bounding box for chosen material
        sizeCard.style.display = '';
        APP.selectedHeight = 150;

        // Set size limits based on chosen material
        const matKey = APP.selectedMaterial === 'resin' ? 'sla' : 'bronze';
        const mat = MATERIALS[matKey];
        if (mat) {
            document.getElementById('size-slider').min = mat.minSize;
            document.getElementById('size-slider').max = mat.maxSize;
            document.getElementById('size-slider').value = Math.min(150, mat.maxSize);
            APP.selectedHeight = Math.min(150, mat.maxSize);
        }
    }

    updateSizeUI();
    updatePrice();
    updateRerollUI();
    bindCustomiseEvents();
}

function setPreset(size) {
    if (APP.productType === 'keyring') return;
    APP.selectedHeight = size;
    document.getElementById('size-slider').value = size;
    document.querySelectorAll('.preset-btn').forEach(b => {
        b.classList.toggle('active', parseInt(b.dataset.size) === size);
    });
    setModelScale(size);
    updateSizeUI();
    updatePrice();
}

function bindCustomiseEvents() {
    const slider = document.getElementById('size-slider');
    slider.addEventListener('input', () => {
        APP.selectedHeight = parseInt(slider.value);
        document.querySelectorAll('.preset-btn').forEach(b => {
            b.classList.toggle('active', parseInt(b.dataset.size) === APP.selectedHeight);
        });
        setModelScale(APP.selectedHeight);
        updateSizeUI();
        updatePrice();
    });
}

function updateSizeUI() {
    if (APP.productType === 'keyring') return;

    const matKey = APP.selectedMaterial === 'resin' ? 'sla' : 'bronze';
    const mat = MATERIALS[matKey];
    if (!mat) return;

    document.getElementById('size-badge').textContent = APP.selectedHeight + 'mm';
    document.getElementById('size-min-label').textContent = mat.minSize + 'mm';
    document.getElementById('size-max-label').textContent = mat.maxSize + 'mm';

    const v = validateSize(matKey, APP.selectedHeight);
    const w = document.getElementById('size-warning');
    if (!v.valid) { w.textContent = '⚠️ ' + v.message; w.classList.add('visible'); }
    else w.classList.remove('visible');
}

function updatePrice() {
    let result;

    if (APP.productType === 'keyring') {
        result = calculateKeyringPrice();
        // For resin keyring, use different pricing
        if (APP.selectedMaterial === 'resin') {
            result = {
                baseCost: 80,
                markup: 40,
                total: 120,
                isKeyring: true,
                source: 'fixed',
            };
        }
    } else {
        // Statue: use material-aware pricing
        const matKey = APP.selectedMaterial === 'resin' ? 'sla' : 'bronze';
        const finish = APP.selectedMaterial === 'resin' ? 'Natural' : 'Raw';

        // Check Shapeways quotes
        const swQuotes = APP.shapewaysQuotes || {};
        let realCost = null;
        for (const [matId, quote] of Object.entries(swQuotes)) {
            const qName = quote.name.toLowerCase();
            if (APP.selectedMaterial === 'bronze' && qName.includes('bronze')) {
                realCost = quote.shapeways_cost;
                break;
            }
            if (APP.selectedMaterial === 'resin' && (qName.includes('sandstone') || qName.includes('full color'))) {
                realCost = quote.shapeways_cost;
                break;
            }
        }

        if (realCost) {
            const marginPct = MARGIN_TIERS[matKey] || 0.65;
            let markup = realCost * marginPct;
            if (markup < (MIN_PROFIT + API_COST_PER_ORDER)) {
                markup = MIN_PROFIT + API_COST_PER_ORDER;
            }
            result = {
                baseCost: realCost,
                markup: markup,
                total: realCost + markup,
                source: 'shapeways',
            };
        } else {
            result = calculatePrice(matKey, APP.selectedHeight, finish);
        }
    }

    if (!result) return;
    APP.price = result;

    const orderBtn = document.getElementById('btn-order');

    if (!APP.quoteLoaded && APP.productType !== 'keyring') {
        // Still waiting for Shapeways — show estimate
    }

    if (result.total <= 0) {
        orderBtn.textContent = '⏳ Calculating price...';
        orderBtn.disabled = true;
        return;
    }

    const priceStr = '$' + result.total.toFixed(2) + ' AUD';
    const source = result.source === 'shapeways' ? '' : (result.source === 'fixed' ? '' : ' (est.)');
    orderBtn.textContent = `Continue · ${priceStr}${source}`;
    orderBtn.disabled = false;
}

// ─── Shapeways Real Quotes ───
async function fetchShapewaysQuoteWithRetry(taskId) {
    APP.quoteLoaded = false;
    updatePrice();

    await new Promise(r => setTimeout(r, 10000));

    for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise(r => setTimeout(r, 5000));
        console.log(`Shapeways quote attempt ${attempt + 1}...`);

        try {
            const res = await fetch(`/api/shapeways-quote/${taskId}`);
            const data = await res.json();

            if (data.source === 'shapeways' && data.all_materials && Object.keys(data.all_materials).length > 0) {
                APP.shapewaysQuotes = data.all_materials;
                APP.shapewaysDimensions = data.dimensions;

                for (const [matId, quote] of Object.entries(data.all_materials)) {
                    const name = quote.name.toLowerCase();
                    console.log(`  Material ${matId}: ${quote.name} = $${quote.shapeways_cost}`);
                    if (name.includes('bronze')) {
                        APP._shapewaysBronzeCost = quote.shapeways_cost;
                    }
                }

                APP.quoteLoaded = true;
                updatePrice();
                return;
            }
        } catch (e) {
            console.error('Shapeways quote error:', e);
        }
    }

    APP.quoteLoaded = true;
    updatePrice();
}

function resetView() {
    if (viewerControls) {
        viewerControls.reset();
        viewerControls.autoRotate = true;
    }
}

// ─── Screen 7: Order Review ───
function goToOrder() {
    // Capture 3D viewer snapshot
    if (viewerRenderer) {
        viewerRenderer.render(viewerScene, viewerCamera);
        const dataUrl = viewerRenderer.domElement.toDataURL('image/png');
        document.getElementById('order-preview-img').src = dataUrl;
    }

    const matLabel = APP.selectedMaterial === 'resin' ? 'Full Colour Resin' : 'Lost Wax Bronze';
    const priceStr = '$' + APP.price.total.toFixed(2) + ' AUD';
    const leadTime = APP.selectedMaterial === 'resin' ? '1-2 weeks' : '3-4 weeks';

    document.getElementById('order-total-price').textContent = priceStr;
    document.getElementById('order-product').textContent =
        APP.productType === 'keyring' ? 'Keyring' : 'Statue';
    document.getElementById('order-material').textContent = matLabel;
    document.getElementById('order-lead-time').textContent = leadTime;

    if (APP.productType === 'keyring') {
        document.getElementById('order-size-row').style.display = 'none';
    } else {
        document.getElementById('order-size-row').style.display = '';
        document.getElementById('order-size').textContent = APP.selectedHeight + 'mm';
    }

    showScreen('order');
}

function placeOrder() {
    const orderId = 'PP-' + Date.now().toString(36).toUpperCase();
    const matLabel = APP.selectedMaterial === 'resin' ? 'Full Colour Resin' : 'Lost Wax Bronze';
    const leadTime = APP.selectedMaterial === 'resin' ? '1-2 weeks' : '3-4 weeks';

    // Save model
    if (typeof saveModel === 'function') {
        saveModel({
            modelUrl: APP.modelUrl,
            processedImage: APP.processedImage,
            processedPath: APP.processedPath,
            sourceImage: APP.previewUrl,
            productType: APP.productType,
            material: APP.selectedMaterial,
            date: new Date().toLocaleDateString(),
        });
    }

    // Save order
    if (typeof addOrder === 'function') {
        addOrder({
            id: orderId,
            product: APP.productType === 'keyring' ? 'Keyring' : 'Statue',
            material: matLabel,
            size: APP.productType === 'keyring' ? '50mm' : APP.selectedHeight + 'mm',
            price: '$' + APP.price.total.toFixed(2) + ' AUD',
            status: 'Processing',
            date: new Date().toISOString(),
        });
    }

    document.getElementById('success-delivery').textContent = leadTime;
    showScreen('success');
    document.getElementById('success-order-id').textContent = orderId;
}

// ─── Reroll 3D Model ───
async function rerollModel() {
    if (APP.remaining <= 0) {
        alert('No regenerations left today. Try again tomorrow!');
        return;
    }
    if (!APP.processedPath) return;

    showProcessing('Regenerating 3D model...', 'Uses 1 daily credit');
    try {
        setProgress(10);

        const rerollBody = { processed_path: APP.processedPath };
        if (APP.multiviewImages && APP.multiviewImages.length > 0) {
            rerollBody.multiview_paths = [
                APP.processedPath,
                ...APP.multiviewImages.map(v => v.path),
            ];
        }

        const genRes = await fetch('/api/generate-3d', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(rerollBody),
        });

        if (!genRes.ok) {
            const err = await genRes.json();
            throw new Error(err.detail || 'Generation failed');
        }

        const genData = await genRes.json();
        if (genData.remaining !== undefined) APP.remaining = genData.remaining;

        if (genData.task_id) {
            document.getElementById('processing-text').textContent = 'Creating 3D model...';
            for (let i = 0; i < 120; i++) {
                await new Promise(r => setTimeout(r, 3000));
                setProgress(25 + Math.min(i * 0.6, 70));
                try {
                    const res = await fetch(`/api/model-status/${genData.task_id}`);
                    const data = await res.json();
                    if (data.status === 'completed') {
                        APP.modelUrl = data.model_url;
                        break;
                    }
                    if (data.status === 'failed') throw new Error('Failed');
                    document.getElementById('processing-sub').textContent = `Generating... ${data.progress || Math.round(25 + i * 0.6)}%`;
                } catch (e) { /* continue */ }
            }
        } else if (genData.model_url) {
            APP.modelUrl = genData.model_url;
        }

        setProgress(100);
        hideProcessing();
        loadModel(APP.modelUrl || '/static/model.glb');
        updateRerollUI();
    } catch (err) {
        hideProcessing();
        alert(err.message);
    }
}

function updateRerollUI() {
    const btn = document.getElementById('btn-reroll');
    const count = document.getElementById('reroll-count');
    count.textContent = APP.remaining;
    btn.disabled = APP.remaining <= 0;
}

// ─── Collapsible ───
function toggleCollapsible(id) {
    const el = document.getElementById(id);
    const arrow = document.getElementById(id + '-arrow');
    if (el.style.display === 'none') {
        el.style.display = 'block';
        if (arrow) arrow.classList.add('open');
    } else {
        el.style.display = 'none';
        if (arrow) arrow.classList.remove('open');
    }
}

// ─── Social Sharing ───
function shareTo(platform) {
    const text = encodeURIComponent('Just ordered a custom 3D-printed pet keepsake from PawPrints! 🐾✨');
    const url = encodeURIComponent('https://douphraite.com');
    const links = {
        facebook: `https://www.facebook.com/sharer/sharer.php?u=${url}`,
        x: `https://twitter.com/intent/tweet?text=${text}&url=${url}`,
        whatsapp: `https://wa.me/?text=${text}%20${url}`,
    };
    if (links[platform]) window.open(links[platform], '_blank');
}

function copyShareLink() {
    navigator.clipboard.writeText('https://douphraite.com').then(() => {
        alert('Link copied! 📋');
    });
}

// ─── Init ───
showScreen('upload');
