// Firebase-based Services for Troop Tracker

// ==================== FIREBASE SCOUT SERVICE ====================
class FirebaseScoutService {
    constructor(userId, store) {
        this.userId = userId;
        this.store = store;
    }

    // All scouts are implicit - troop shows scout from each user's sales
    // This is a simplified model since each user is already a scout
}

// ==================== FIREBASE SALE SERVICE ====================
class FirebaseSaleService {
    constructor(userId, store) {
        this.userId = userId;
        this.store = store;
    }

    async addSale(saleData) {
        return await this.store.addSale(saleData);
    }

    async getSales() {
        return await this.store.getSales();
    }

    async deleteSale(saleId) {
        await this.store.deleteSale(saleId);
    }

    async getTotalRaised() {
        const sales = await this.store.getSales();
        return sales.reduce((sum, s) => sum + Number(s.amount || 0), 0);
    }

    async getTotalCardsSold() {
        const sales = await this.store.getSales();
        return sales.reduce((sum, s) => {
            if (!s || s.type !== 'card') return sum;
            const qty = Number(s.qty);
            if (Number.isFinite(qty) && qty > 0) return sum + Math.floor(qty);
            return sum + 1;
        }, 0);
    }

    async getTotalDonations() {
        const sales = await this.store.getSales();
        return sales.filter(s => s.type === 'donation').length;
    }

    async getRecentSales(limit = 10) {
        const sales = await this.store.getSales();
        return sales
            .sort((a, b) => {
                const dateA = a.date ? new Date(a.date) : new Date(0);
                const dateB = b.date ? new Date(b.date) : new Date(0);
                return dateB - dateA;
            })
            .slice(0, limit);
    }

    async filterSales(searchTerm, typeFilter, paymentFilter) {
        let sales = await this.store.getSales();

        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            sales = sales.filter(s =>
                (s.customerName || '').toLowerCase().includes(term)
            );
        }

        if (typeFilter && typeFilter !== 'all') {
            sales = sales.filter(s => s.type === typeFilter);
        }

        if (paymentFilter && paymentFilter !== 'all') {
            sales = sales.filter(s => s.paymentMethod === paymentFilter);
        }

        return sales.sort((a, b) => {
            const dateA = a.date ? new Date(a.date) : new Date(0);
            const dateB = b.date ? new Date(b.date) : new Date(0);
            return dateB - dateA;
        });
    }
}

// ==================== FIREBASE SETTINGS SERVICE ====================
class FirebaseSettingsService {
    constructor(userId, store) {
        this.userId = userId;
        this.store = store;
    }

    async getSettings() {
        return await this.store.loadSettings();
    }

    async updateSettings(settings) {
        await this.store.saveSettings(settings);
    }

    async getFundraisingGoal() {
        const settings = await this.getSettings();
        return parseFloat(settings.fundraisingGoal) || 5000;
    }

    async getCardPrice() {
        const settings = await this.getSettings();
        return parseFloat(settings.cardPrice) || 20;
    }

    async getPaymentHandles() {
        const settings = await this.getSettings();
        return settings.paymentHandles || {};
    }
}

// ==================== FIREBASE DASHBOARD SERVICE ====================
class FirebaseDashboardService {
    constructor(saleService, store, settingsService) {
        this.sales = saleService;
        this.store = store;
        this.settings = settingsService;
    }

    async getDashboardStats() {
        const totalRaised = await this.sales.getTotalRaised();
        const fundraisingGoal = await this.settings.getFundraisingGoal();
        return {
            totalRaised,
            cardsSold: await this.sales.getTotalCardsSold(),
            donationsCount: await this.sales.getTotalDonations(),
            scoutsActive: 1, // Current user
            fundraisingGoal,
            goalProgress: fundraisingGoal > 0 ? (totalRaised / fundraisingGoal) * 100 : 0,
            troop: await this.store.getTroopStats()
        };
    }

    async getRecentActivity(limit = 10) {
        return await this.sales.getRecentSales(limit);
    }

    async getTroopStats() {
        return await this.store.getTroopStats();
    }
}
