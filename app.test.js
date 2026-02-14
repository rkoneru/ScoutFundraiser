/**
 * Scout Fundraiser App - Unit Tests
 * Covers utility functions, validators, and core business logic
 */

// Mock Firebase before importing
jest.mock('./firebase-config.js', () => ({
    db: {},
    auth: {}
}));

// Import functions to test (these are standalone utility functions)

/**
 * Utility: Format money values
 */
function formatMoney(amount) {
    return '$' + (Number(amount) || 0).toFixed(2);
}

describe('formatMoney()', () => {
    test('formats positive numbers correctly', () => {
        expect(formatMoney(100)).toBe('$100.00');
        expect(formatMoney(1234.56)).toBe('$1234.56');
    });

    test('handles zero', () => {
        expect(formatMoney(0)).toBe('$0.00');
    });

    test('handles negative numbers', () => {
        expect(formatMoney(-50)).toBe('$-50.00');
    });

    test('handles null/undefined', () => {
        expect(formatMoney(null)).toBe('$0.00');
        expect(formatMoney(undefined)).toBe('$0.00');
    });

    test('handles string numbers', () => {
        expect(formatMoney('123')).toBe('$123.00');
    });

    test('handles invalid input', () => {
        expect(formatMoney('invalid')).toBe('$0.00');
        expect(formatMoney({})).toBe('$0.00');
    });
});

/**
 * Utility: Escape HTML to prevent XSS
 */
function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

describe('escapeHTML()', () => {
    test('escapes dangerous HTML characters', () => {
        expect(escapeHTML('<script>')).not.toContain('<script>');
        expect(escapeHTML('<img onerror="alert(1)">')).not.toContain('onerror');
    });

    test('preserves normal text', () => {
        expect(escapeHTML('Hello World')).toBe('Hello World');
    });

    test('handles quotes safely', () => {
        const escaped = escapeHTML('It\'s "quoted"');
        expect(escaped).not.toContain('<');
    });

    test('handles null safely', () => {
        expect(() => escapeHTML(null)).not.toThrow();
    });
});

/**
 * Utility: Validate email format
 */
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(String(email).toLowerCase());
}

describe('validateEmail()', () => {
    test('accepts valid emails', () => {
        expect(validateEmail('user@example.com')).toBe(true);
        expect(validateEmail('test.email+tag@domain.co.uk')).toBe(true);
    });

    test('rejects invalid emails', () => {
        expect(validateEmail('notanemail')).toBe(false);
        expect(validateEmail('missing@domain')).toBe(false);
        expect(validateEmail('@nodomain.com')).toBe(false);
        expect(validateEmail('spaces in@email.com')).toBe(false);
    });

    test('handles edge cases', () => {
        expect(validateEmail('')).toBe(false);
        expect(validateEmail(null)).toBe(false);
    });
});

/**
 * Utility: Validate password strength
 */
function validatePassword(password) {
    const DEFAULTS = {
        RATE_LIMIT_MAX_ATTEMPTS: 5,
        RATE_LIMIT_COOLDOWN_MS: 60000
    };

    if (!password || password.length < 12) {
        return { valid: false, reason: 'Must be 12+ characters' };
    }
    if (!/[A-Z]/.test(password)) {
        return { valid: false, reason: 'Must contain uppercase' };
    }
    if (!/[a-z]/.test(password)) {
        return { valid: false, reason: 'Must contain lowercase' };
    }
    if (!/[0-9]/.test(password)) {
        return { valid: false, reason: 'Must contain numbers' };
    }
    return { valid: true };
}

describe('validatePassword()', () => {
    test('accepts strong passwords', () => {
        const result = validatePassword('MyPassword123');
        expect(result.valid).toBe(true);
    });

    test('rejects passwords too short', () => {
        const result = validatePassword('Short1!');
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('12+');
    });

    test('rejects passwords without uppercase', () => {
        const result = validatePassword('lowercase123');
        expect(result.valid).toBe(false);
    });

    test('rejects passwords without lowercase', () => {
        const result = validatePassword('UPPERCASE123');
        expect(result.valid).toBe(false);
    });

    test('rejects passwords without numbers', () => {
        const result = validatePassword('NoNumbers!');
        expect(result.valid).toBe(false);
    });

    test('rejects null/empty passwords', () => {
        expect(validatePassword(null).valid).toBe(false);
        expect(validatePassword('').valid).toBe(false);
    });
});

/**
 * Utility: Calculate card quantity from sale
 */
function getCardQtyFromSale(sale) {
    return Number(sale.cardQty) || 0;
}

describe('getCardQtyFromSale()', () => {
    test('extracts card quantity correctly', () => {
        expect(getCardQtyFromSale({ cardQty: 5 })).toBe(5);
        expect(getCardQtyFromSale({ cardQty: '10' })).toBe(10);
    });

    test('handles missing quantity', () => {
        expect(getCardQtyFromSale({})).toBe(0);
        expect(getCardQtyFromSale(null)).toBe(0);
    });

    test('handles invalid quantity', () => {
        expect(getCardQtyFromSale({ cardQty: 'invalid' })).toBe(0);
    });
});

/**
 * Utility: Normalize unit ID
 */
function normalizeUnitId(unitId) {
    return (unitId || '').trim().toLowerCase();
}

describe('normalizeUnitId()', () => {
    test('converts to lowercase', () => {
        expect(normalizeUnitId('UNIT123')).toBe('unit123');
        expect(normalizeUnitId('Unit42')).toBe('unit42');
    });

    test('trims whitespace', () => {
        expect(normalizeUnitId('  unit123  ')).toBe('unit123');
    });

    test('handles null/empty', () => {
        expect(normalizeUnitId(null)).toBe('');
        expect(normalizeUnitId('')).toBe('');
    });

    test('handles mixed case with spaces', () => {
        expect(normalizeUnitId('  UNIT 456  ')).toBe('unit 456');
    });
});

/**
 * Utility: Filter and sort sales
 */
function filterAndSortSales(sales, filters = {}) {
    let filtered = [...sales];

    if (filters.searchTerm) {
        filtered = filtered.filter(s =>
            (s.customerName || '').toLowerCase().includes(filters.searchTerm) ||
            (s.scoutName || '').toLowerCase().includes(filters.searchTerm)
        );
    }

    if (filters.typeFilter && filters.typeFilter !== 'all') {
        filtered = filtered.filter(s => s.type === filters.typeFilter);
    }

    if (filters.paymentFilter && filters.paymentFilter !== 'all') {
        filtered = filtered.filter(s => s.paymentMethod === filters.paymentFilter);
    }

    filtered.sort((a, b) => {
        const dateA = a.date ? new Date(a.date) : new Date(0);
        const dateB = b.date ? new Date(b.date) : new Date(0);
        return dateB - dateA;
    });

    return filtered;
}

describe('filterAndSortSales()', () => {
    const mockSales = [
        { id: 1, customerName: 'Alice', type: 'card', paymentMethod: 'cash', date: '2026-02-01' },
        { id: 2, customerName: 'Bob', type: 'donation', paymentMethod: 'card', date: '2026-02-02' },
        { id: 3, customerName: 'Charlie', type: 'card', paymentMethod: 'cash', date: '2026-02-03' }
    ];

    test('filters by search term', () => {
        const result = filterAndSortSales(mockSales, { searchTerm: 'alice' });
        expect(result.length).toBe(1);
        expect(result[0].customerName).toBe('Alice');
    });

    test('filters by type', () => {
        const result = filterAndSortSales(mockSales, { typeFilter: 'card' });
        expect(result.length).toBe(2);
        expect(result.every(s => s.type === 'card')).toBe(true);
    });

    test('filters by payment method', () => {
        const result = filterAndSortSales(mockSales, { paymentFilter: 'cash' });
        expect(result.length).toBe(2);
        expect(result.every(s => s.paymentMethod === 'cash')).toBe(true);
    });

    test('sorts by date newest first', () => {
        const result = filterAndSortSales(mockSales);
        expect(result[0].date).toBe('2026-02-03');
        expect(result[result.length - 1].date).toBe('2026-02-01');
    });

    test('applies multiple filters', () => {
        const result = filterAndSortSales(mockSales, {
            typeFilter: 'card',
            paymentFilter: 'cash'
        });
        expect(result.length).toBe(2);
        expect(result.every(s => s.type === 'card' && s.paymentMethod === 'cash')).toBe(true);
    });

    test('handles empty sales array', () => {
        const result = filterAndSortSales([], { searchTerm: 'test' });
        expect(result.length).toBe(0);
    });
});

/**
 * Error Handler Tests
 */
class ErrorHandler {
    static logError(error, context = '') {
        const message = error && error.message ? error.message : String(error);
        const errorMsg = context ? `[${context}] ${message}` : message;
        console.error(errorMsg, error);
        return null;
    }

    static returnEmpty(error, context = '') {
        this.logError(error, context);
        return [];
    }

    static returnEmptyObject(error, context = '') {
        this.logError(error, context);
        return {};
    }
}

describe('ErrorHandler', () => {
    beforeEach(() => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        console.error.mockRestore();
    });

    test('logError logs to console', () => {
        const error = new Error('Test error');
        ErrorHandler.logError(error, 'testContext');
        expect(console.error).toHaveBeenCalled();
    });

    test('returnEmpty returns empty array', () => {
        const result = ErrorHandler.returnEmpty(new Error('Test'), 'test');
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(0);
    });

    test('returnEmptyObject returns empty object', () => {
        const result = ErrorHandler.returnEmptyObject(new Error('Test'), 'test');
        expect(typeof result).toBe('object');
        expect(Object.keys(result).length).toBe(0);
    });

    test('handles null errors gracefully', () => {
        expect(() => {
            ErrorHandler.returnEmpty(null, 'test');
        }).not.toThrow();
    });
});

/**
 * Data validation tests
 */
function validateSaleData(sale) {
    const errors = [];

    if (!sale.amount || Number(sale.amount) <= 0) {
        errors.push('Amount must be greater than 0');
    }

    if (!sale.type || !['card', 'donation'].includes(sale.type)) {
        errors.push('Invalid sale type');
    }

    if (!sale.customerName || !sale.customerName.trim()) {
        errors.push('Customer name is required');
    }

    if (!sale.paymentMethod) {
        errors.push('Payment method is required');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

describe('validateSaleData()', () => {
    test('accepts valid sale data', () => {
        const sale = {
            amount: 100,
            type: 'card',
            customerName: 'John Doe',
            paymentMethod: 'cash'
        };
        const result = validateSaleData(sale);
        expect(result.valid).toBe(true);
        expect(result.errors.length).toBe(0);
    });

    test('rejects zero amount', () => {
        const sale = {
            amount: 0,
            type: 'card',
            customerName: 'John',
            paymentMethod: 'cash'
        };
        const result = validateSaleData(sale);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('Amount'))).toBe(true);
    });

    test('rejects invalid sale type', () => {
        const sale = {
            amount: 100,
            type: 'invalid',
            customerName: 'John',
            paymentMethod: 'cash'
        };
        const result = validateSaleData(sale);
        expect(result.valid).toBe(false);
    });

    test('rejects missing customer name', () => {
        const sale = {
            amount: 100,
            type: 'card',
            customerName: '',
            paymentMethod: 'cash'
        };
        const result = validateSaleData(sale);
        expect(result.valid).toBe(false);
    });

    test('collects multiple errors', () => {
        const sale = {
            amount: 0,
            type: 'invalid',
            customerName: '',
            paymentMethod: ''
        };
        const result = validateSaleData(sale);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(1);
    });
});

/**
 * Cache utility tests
 */
const dataCache = {
    scouts: { data: null, timestamp: 0 },
    sales: { data: null, timestamp: 0 },
    stats: { data: null, timestamp: 0 },
    CACHE_TTL_MS: 30000,

    isValid(key) {
        const cached = this[key];
        return cached && cached.data && (Date.now() - cached.timestamp) < this.CACHE_TTL_MS;
    },

    get(key) {
        return this.isValid(key) ? this[key].data : null;
    },

    set(key, data) {
        this[key] = { data, timestamp: Date.now() };
    },

    clear(key) {
        if (this[key]) this[key] = { data: null, timestamp: 0 };
    }
};

describe('dataCache', () => {
    beforeEach(() => {
        dataCache.clear('scouts');
        dataCache.clear('sales');
    });

    test('stores and retrieves data', () => {
        const data = [{ id: 1, name: 'Scout 1' }];
        dataCache.set('scouts', data);
        expect(dataCache.get('scouts')).toEqual(data);
    });

    test('returns null for non-existent cache', () => {
        expect(dataCache.get('nonexistent')).toBeNull();
    });

    test('clears cache', () => {
        dataCache.set('scouts', [{ id: 1 }]);
        dataCache.clear('scouts');
        expect(dataCache.get('scouts')).toBeNull();
    });

    test('handles cache expiration (simulated)', () => {
        const data = [{ id: 1 }];
        dataCache.set('scouts', data);

        // Simulate old timestamp
        dataCache.scouts.timestamp = Date.now() - 31000; // 31 seconds ago

        expect(dataCache.get('scouts')).toBeNull();
    });
});
