// PawPrints — 3D Viewer Module
// Wraps three.js for the customisation screen

let viewerScene, viewerCamera, viewerRenderer, viewerControls, viewerModel;
let viewerBaseScale = 1;
let viewerAnimationId = null;

function initViewer(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Scene
    viewerScene = new THREE.Scene();
    viewerScene.background = new THREE.Color(0x1a1a2e);

    // Camera
    viewerCamera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    viewerCamera.position.set(0, 1.5, 4);

    // Renderer
    viewerRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    viewerRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    viewerRenderer.setSize(container.clientWidth, container.clientHeight);
    viewerRenderer.shadowMap.enabled = true;
    viewerRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(viewerRenderer.domElement);

    // Controls
    viewerControls = new THREE.OrbitControls(viewerCamera, viewerRenderer.domElement);
    viewerControls.enableDamping = true;
    viewerControls.dampingFactor = 0.05;
    viewerControls.autoRotate = true;
    viewerControls.autoRotateSpeed = 1.5;
    viewerControls.maxPolarAngle = Math.PI * 0.85;

    // Lighting
    viewerScene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1);
    keyLight.position.set(5, 10, 7);
    keyLight.castShadow = true;
    viewerScene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(-5, 2, -5);
    viewerScene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 0.2);
    rimLight.position.set(0, -3, -5);
    viewerScene.add(rimLight);

    // Ground
    const groundGeo = new THREE.PlaneGeometry(10, 10);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x2a2a4e, roughness: 0.9 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.5;
    ground.receiveShadow = true;
    viewerScene.add(ground);

    // Grid
    const grid = new THREE.GridHelper(10, 20, 0x444466, 0x333355);
    grid.position.y = -0.49;
    viewerScene.add(grid);

    // Resize
    const ro = new ResizeObserver(() => {
        viewerCamera.aspect = container.clientWidth / container.clientHeight;
        viewerCamera.updateProjectionMatrix();
        viewerRenderer.setSize(container.clientWidth, container.clientHeight);
    });
    ro.observe(container);

    // Animate
    function animate() {
        viewerAnimationId = requestAnimationFrame(animate);
        viewerControls.update();
        viewerRenderer.render(viewerScene, viewerCamera);
    }
    animate();
}

function loadModel(url) {
    return new Promise((resolve, reject) => {
        const loader = new THREE.GLTFLoader();
        loader.load(url, (gltf) => {
            if (viewerModel) viewerScene.remove(viewerModel);

            viewerModel = gltf.scene;
            const box = new THREE.Box3().setFromObject(viewerModel);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());

            viewerModel.position.sub(center);
            viewerModel.position.y += size.y / 2;

            const maxDim = Math.max(size.x, size.y, size.z);
            viewerBaseScale = 1.5 / maxDim;
            viewerModel.scale.setScalar(viewerBaseScale);

            viewerModel.traverse(child => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });

            viewerScene.add(viewerModel);
            resolve(viewerModel);
        }, undefined, reject);
    });
}

function setModelScale(heightMm) {
    if (!viewerModel) return;
    const scaleFactor = heightMm / 100;
    viewerModel.scale.setScalar(viewerBaseScale * scaleFactor);
}

function setModelColor(hexColor) {
    if (!viewerModel) return;
    const color = new THREE.Color(hexColor);
    viewerModel.traverse(child => {
        if (child.isMesh) {
            if (!child.userData._origMat) {
                child.userData._origMat = child.material.clone();
            }
            child.material = child.material.clone();
            child.material.color = color;
        }
    });
}

function resetModelColor() {
    if (!viewerModel) return;
    viewerModel.traverse(child => {
        if (child.isMesh && child.userData._origMat) {
            child.material = child.userData._origMat.clone();
        }
    });
}

function setWireframe(enabled) {
    if (!viewerModel) return;
    viewerModel.traverse(child => {
        if (child.isMesh) {
            child.material.wireframe = enabled;
        }
    });
}

function destroyViewer() {
    if (viewerAnimationId) cancelAnimationFrame(viewerAnimationId);
    if (viewerRenderer) viewerRenderer.dispose();
    viewerModel = null;
}
