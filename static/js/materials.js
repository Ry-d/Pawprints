// PawPrints — Material & Pricing Data
// Based on Shapeways design guidelines

const MATERIALS = {
    abs: {
        id: 'abs',
        name: 'ABS Plastic',
        tagline: 'Durable & lightweight',
        description: 'High-resolution FDM/FFF print. Durable, great for display.',
        icon: '🏷️',
        tier: '$',
        swatchColor: '#E8E8E8',
        swatchStyle: 'background: linear-gradient(135deg, #F0F0F0, #D0D0D0)',
        // Shapeways constraints
        minSize: 10,   // mm
        maxSize: 300,   // mm bounding box
        minWall: 1.0,   // mm wall thickness
        basePricePerCm3: 0.28,  // USD per cm³
        setupFee: 5.00,
        colors: [
            { name: 'White',    hex: '#F5F5F0' },
            { name: 'Black',    hex: '#1A1A1A' },
            { name: 'Red',      hex: '#CC3333' },
            { name: 'Blue',     hex: '#3366CC' },
            { name: 'Green',    hex: '#339966' },
        ],
        finishes: ['Standard', 'Polished', 'Matte'],
        finishMultiplier: { 'Standard': 1.0, 'Polished': 1.2, 'Matte': 1.1 },
    },
    sla: {
        id: 'sla',
        name: 'Full Colour Sandstone',
        tagline: 'Stone-like with full colour',
        description: 'Binder jet / SLA with stone-like texture. Supports full RGB colour.',
        icon: '🎨',
        tier: '$$',
        swatchColor: '#D4A373',
        swatchStyle: 'background: linear-gradient(135deg, #D4A373, #B8956A)',
        minSize: 15,
        maxSize: 200,   // mm — more limited build volume
        minWall: 2.0,
        basePricePerCm3: 0.75,
        setupFee: 8.00,
        colors: [
            { name: 'Full Colour', hex: 'rainbow' },
            { name: 'Sandstone',   hex: '#D4A373' },
            { name: 'Charcoal',    hex: '#3D3D3D' },
            { name: 'Terracotta',  hex: '#C45E3A' },
            { name: 'Sage',        hex: '#8FBC8F' },
        ],
        finishes: ['Natural', 'Coated', 'Polished'],
        finishMultiplier: { 'Natural': 1.0, 'Coated': 1.15, 'Polished': 1.3 },
    },
    bronze: {
        id: 'bronze',
        name: 'Lost Wax Bronze',
        tagline: 'Heirloom quality',
        description: 'Investment cast bronze via lost wax method. True metal, lifetime keepsake.',
        icon: '👑',
        tier: '$$$',
        swatchColor: '#CD7F32',
        swatchStyle: 'background: linear-gradient(135deg, #CD7F32, #A0652A)',
        minSize: 20,
        maxSize: 150,
        minWall: 3.0,
        basePricePerCm3: 6.00,
        setupFee: 25.00,
        colors: [
            { name: 'Bronze', hex: '#CD7F32' },
        ],
        finishes: ['Raw', 'Satin', 'Polished', 'Patina'],
        finishMultiplier: { 'Raw': 1.0, 'Satin': 1.15, 'Polished': 1.3, 'Patina': 1.2 },
        finishInfo: {
            'Raw': {
                desc: 'Natural cast finish with subtle texture. Warm, authentic look.',
                color: '#B87333',
            },
            'Satin': {
                desc: 'Smooth, brushed surface with a soft sheen. Elegant and understated.',
                color: '#D4956A',
            },
            'Polished': {
                desc: 'Mirror-like high shine. Bright, reflective, premium feel.',
                color: '#E8B86D',
            },
            'Patina': {
                desc: 'Aged green-brown finish. Classic antique bronze character.',
                color: '#4A6741',
            },
        },
    }
};

// Tiered margins — higher % on cheap materials, lower on premium
// Minimum $20 profit per order after API costs (~$2 remove.bg + ~$3 Meshy)
const API_COST_PER_ORDER = 5.00; // approximate fixed cost per generation

const MARGIN_TIERS = {
    abs:    0.90,  // 90% — low base cost needs high margin
    sla:    0.65,  // 65% — mid-range
    bronze: 0.45,  // 45% — high base, lower % still big profit
};

const MIN_PROFIT = 20.00; // floor: at least $20 profit per order

// Keyring: fixed pricing — bronze 50mm
// Shapeways ~$240 + our $80 margin = $320 retail
const KEYRING_BASE_COST = 240;
const KEYRING_MARGIN_FIXED = 80;

function calculateKeyringPrice() {
    return {
        baseCost: KEYRING_BASE_COST,
        markup: KEYRING_MARGIN_FIXED,
        profit: KEYRING_MARGIN_FIXED - API_COST_PER_ORDER,
        total: KEYRING_BASE_COST + KEYRING_MARGIN_FIXED,
        isKeyring: true,
        source: 'fixed',
    };
}

/**
 * Calculate price for a given material, height, and finish
 * Estimates volume from height assuming rough pet statue proportions
 */
function calculatePrice(materialId, heightMm, finish) {
    const mat = MATERIALS[materialId];
    if (!mat) return null;

    const hCm = heightMm / 10;
    const estimatedVolumeCm3 = 0.12 * Math.pow(hCm, 2.4);

    const materialCost = estimatedVolumeCm3 * mat.basePricePerCm3;
    const finishMult = mat.finishMultiplier[finish] || 1.0;
    const baseCost = (materialCost * finishMult) + mat.setupFee;

    // Tiered margin
    const marginPct = MARGIN_TIERS[materialId] || 0.65;
    let markup = baseCost * marginPct;

    // Enforce minimum profit floor
    if (markup < (MIN_PROFIT + API_COST_PER_ORDER)) {
        markup = MIN_PROFIT + API_COST_PER_ORDER;
    }

    const total = baseCost + markup;

    return {
        volume: estimatedVolumeCm3,
        materialCost: materialCost,
        setupFee: mat.setupFee,
        finishMultiplier: finishMult,
        baseCost: baseCost,
        marginPct: marginPct,
        markup: markup,
        apiCost: API_COST_PER_ORDER,
        profit: markup - API_COST_PER_ORDER,
        total: total,
    };
}

/**
 * Validate size against material constraints
 */
function validateSize(materialId, heightMm) {
    const mat = MATERIALS[materialId];
    if (!mat) return { valid: false, message: 'Unknown material' };

    if (heightMm < mat.minSize) {
        return { valid: false, message: `Minimum size for ${mat.name} is ${mat.minSize}mm` };
    }
    if (heightMm > mat.maxSize) {
        return { valid: false, message: `Maximum size for ${mat.name} is ${mat.maxSize}mm`, clamped: mat.maxSize };
    }
    return { valid: true };
}
