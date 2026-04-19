// ==================== RECEIPT MANAGEMENT MODULE ====================

class ReceiptManager {
    constructor(db, userId) {
        this.db = db;
        this.userId = userId;
        this.currentReceipt = null;
    }

    generateReceiptNumber() {
        return `RCP-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    }

    async saveReceipt(receiptData) {
        const { collection, addDoc, serverTimestamp } = window.firebaseImports;
        try {
            const receipt = {
                ...receiptData,
                createdAt: new Date().toISOString(),
                createdBy: this.userId,
                userId: this.userId
            };
            console.log('[RECEIPT] Saving receipt:', receipt);
            const docRef = await addDoc(collection(this.db, 'receipts'), receipt);
            console.log('[RECEIPT] Receipt saved with ID:', docRef.id);
            return { id: docRef.id, ...receipt };
        } catch (error) {
            console.error('Error saving receipt:', error);
            throw error;
        }
    }

    async getUserReceipts() {
        const { collection, query, where, getDocs } = window.firebaseImports;
        try {
            const q = query(
                collection(this.db, 'receipts'),
                where('createdBy', '==', this.userId)
            );
            const snapshot = await getDocs(q);
            const receipts = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    ...data,
                    date: data.date || new Date().toISOString()
                };
            }).sort((a, b) => new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0));
            console.log('[RECEIPT] Loaded receipts:', receipts);
            return receipts;
        } catch (error) {
            console.error('Error fetching user receipts:', error);
            return [];
        }
    }

    async getTroopReceipts(troopId) {
        const { collection, query, where, getDocs, orderBy } = window.firebaseImports;
        try {
            const q = query(
                collection(this.db, 'receipts'),
                where('type', '==', 'troop'),
                where('troopInfo.troopId', '==', troopId),
                orderBy('createdAt', 'desc')
            );
            const snapshot = await getDocs(q);
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (error) {
            console.error('Error fetching troop receipts:', error);
            return [];
        }
    }

    async getReceiptById(receiptId) {
        const { doc, getDoc } = window.firebaseImports;
        try {
            const docSnap = await getDoc(doc(this.db, 'receipts', receiptId));
            if (docSnap.exists()) {
                return { id: docSnap.id, ...docSnap.data() };
            }
            return null;
        } catch (error) {
            console.error('Error fetching receipt:', error);
            return null;
        }
    }

    async deleteReceipt(receiptId) {
        const { deleteDoc, doc } = window.firebaseImports;
        try {
            await deleteDoc(doc(this.db, 'receipts', receiptId));
        } catch (error) {
            console.error('Error deleting receipt:', error);
            throw error;
        }
    }

    generateScoutReceipt(salesData, scoutInfo, troopInfo) {
        const totalAmount = salesData.reduce((sum, s) => sum + Number(s.amount || 0), 0);
        const cardAmount = salesData
            .filter(s => s.type === 'card')
            .reduce((sum, s) => sum + Number(s.amount || 0), 0);
        const donationAmount = salesData
            .filter(s => s.type === 'donation')
            .reduce((sum, s) => sum + Number(s.amount || 0), 0);
        const totalCards = salesData.filter(s => s.type === 'card').reduce((sum, s) => {
            const qty = Number(s.qty || 1);
            return sum + (Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 1);
        }, 0);
        const totalDonations = salesData.filter(s => s.type === 'donation').length;

        return {
            receiptNumber: this.generateReceiptNumber(),
            type: 'scout',
            userId: this.userId,
            scoutName: scoutInfo.scoutName || '',
            scoutId: scoutInfo.scoutId || this.userId,
            troopInfo: troopInfo || {},
            date: new Date().toISOString(),
            sales: salesData,
            totalAmount,
            totalCards,
            totalDonations,
            cardAmount,
            donationAmount,
            additionalInfo: {}
        };
    }

    generateTroopReceipt(allSalesData, troopInfo, scoutBreakdown) {
        const totalAmount = allSalesData.reduce((sum, s) => sum + Number(s.amount || 0), 0);
        const cardAmount = allSalesData
            .filter(s => s.type === 'card')
            .reduce((sum, s) => sum + Number(s.amount || 0), 0);
        const donationAmount = allSalesData
            .filter(s => s.type === 'donation')
            .reduce((sum, s) => sum + Number(s.amount || 0), 0);
        const totalCards = allSalesData.filter(s => s.type === 'card').reduce((sum, s) => {
            const qty = Number(s.qty || 1);
            return sum + (Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 1);
        }, 0);
        const totalDonations = allSalesData.filter(s => s.type === 'donation').length;

        return {
            receiptNumber: this.generateReceiptNumber(),
            type: 'troop',
            troopInfo: troopInfo || {},
            date: new Date().toISOString(),
            totalAmount,
            totalCards,
            totalDonations,
            cardAmount,
            donationAmount,
            scoutBreakdown: scoutBreakdown || [],
            additionalInfo: {}
        };
    }

    generateReceiptHTML(receipt) {
        const isScoutReceipt = receipt.type === 'scout';
        const receiptDate = new Date(receipt.date);
        const dateStr = receiptDate.toLocaleDateString('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });

        // Calculate card and donation amounts from sales if not already set
        let cardAmount = 0;
        let donationAmount = 0;
        
        if (receipt.cardAmount !== undefined) {
            cardAmount = receipt.cardAmount;
        } else if (receipt.sales && Array.isArray(receipt.sales)) {
            cardAmount = receipt.sales
                .filter(s => s && s.type === 'card')
                .reduce((sum, s) => sum + Number(s.amount || 0), 0);
        }
        
        if (receipt.donationAmount !== undefined) {
            donationAmount = receipt.donationAmount;
        } else if (receipt.sales && Array.isArray(receipt.sales)) {
            donationAmount = receipt.sales
                .filter(s => s && s.type === 'donation')
                .reduce((sum, s) => sum + Number(s.amount || 0), 0);
        }
        
        const cardAmountStr = Number(cardAmount).toFixed(2);
        const donationAmountStr = Number(donationAmount).toFixed(2);

        console.log('[RECEIPT HTML] Card/Donation amounts:', { cardAmount, donationAmount, cardAmountStr, donationAmountStr, totalCards: receipt.totalCards, totalDonations: receipt.totalDonations, hasSales: !!(receipt.sales && receipt.sales.length) });

        // Generate sales summary table
        const salesSummary = this.generateSalesSummary(receipt.sales || []);
        const salesRows = Object.values(salesSummary).map((item, idx) => `
            <tr>
                <td>${idx + 1}</td>
                <td>${item.type}</td>
                <td>${item.paymentMethod}</td>
                <td class="text-right">${item.count}</td>
                <td class="text-right">$${item.totalAmount.toFixed(2)}</td>
            </tr>
        `).join('');

        const scoutBreakdownRows = (receipt.scoutBreakdown || []).map((scout, idx) => `
            <tr>
                <td>${idx + 1}</td>
                <td>${scout.scoutName || 'Unknown Scout'}</td>
                <td class="text-right">${scout.totalCards || 0}</td>
                <td class="text-right">$${Number(scout.totalAmount || 0).toFixed(2)}</td>
            </tr>
        `).join('');

        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Receipt - ${receipt.receiptNumber}</title>
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body { font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px; }
                    .receipt-container { max-width: 800px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
                    .receipt-header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #003366; padding-bottom: 20px; }
                    .receipt-header h1 { color: #003366; font-size: 28px; margin-bottom: 5px; }
                    .receipt-number { color: #666; font-size: 12px; margin: 5px 0; }
                    .receipt-info { margin: 20px 0; }
                    .receipt-info-row { display: flex; justify-content: space-between; margin: 8px 0; font-size: 14px; }
                    .receipt-info-row strong { color: #003366; min-width: 150px; }
                    .section-title { font-size: 16px; font-weight: bold; color: #003366; margin-top: 30px; margin-bottom: 15px; border-bottom: 1px solid #ddd; padding-bottom: 10px; }
                    table { width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 14px; }
                    th { background: #f0f0f0; color: #003366; padding: 10px; text-align: left; font-weight: bold; border-bottom: 2px solid #003366; }
                    td { padding: 10px; border-bottom: 1px solid #eee; }
                    .text-right { text-align: right; }
                    .summary { margin-top: 30px; padding-top: 20px; border-top: 2px solid #003366; }
                    .summary-row { display: flex; justify-content: space-between; margin: 10px 0; font-size: 16px; }
                    .summary-row.total { font-weight: bold; color: #003366; font-size: 18px; }
                    .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px; }
                    .no-print { display: none; }
                    @media print {
                        body { background: white; padding: 0; }
                        .no-print { display: none !important; }
                        .receipt-container { box-shadow: none; max-width: 100%; }
                    }
                </style>
            </head>
            <body>
                <div class="receipt-container">
                    <div class="receipt-header">
                        <h1>RECEIPT</h1>
                        <div class="receipt-number">#${receipt.receiptNumber}</div>
                        <div class="receipt-number">Date: ${dateStr}</div>
                    </div>

                    <div class="receipt-info">
                        ${isScoutReceipt ? `
                            <div class="receipt-info-row">
                                <strong>Scout Name:</strong>
                                <span>${receipt.scoutName || 'N/A'}</span>
                            </div>
                        ` : ''}

                        ${receipt.troopInfo.troopName ? `
                            <div class="receipt-info-row">
                                <strong>Troop:</strong>
                                <span>${receipt.troopInfo.troopName}</span>
                            </div>
                        ` : ''}

                        ${receipt.troopInfo.troopNumber ? `
                            <div class="receipt-info-row">
                                <strong>Troop #:</strong>
                                <span>${receipt.troopInfo.troopNumber}</span>
                            </div>
                        ` : ''}

                        ${receipt.troopInfo.taxExemptId ? `
                            <div class="receipt-info-row">
                                <strong>Tax Exempt ID:</strong>
                                <span>${receipt.troopInfo.taxExemptId}</span>
                            </div>
                        ` : ''}
                    </div>

                    ${isScoutReceipt && receipt.sales && receipt.sales.length > 0 ? `
                        <div class="section-title">Sales Summary</div>
                        <table>
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Type</th>
                                    <th>Payment Method</th>
                                    <th class="text-right">Count</th>
                                    <th class="text-right">Total Amount</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${salesRows}
                            </tbody>
                        </table>
                    ` : ''}

                    ${!isScoutReceipt && receipt.scoutBreakdown && receipt.scoutBreakdown.length > 0 ? `
                        <div class="section-title">Scout Breakdown</div>
                        <table>
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Scout Name</th>
                                    <th class="text-right">Cards Sold</th>
                                    <th class="text-right">Total Amount</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${scoutBreakdownRows}
                            </tbody>
                        </table>
                    ` : ''}

                    <div class="summary">
                        <div class="summary-row">
                            <span>Total Cards Sold:</span>
                            <span>${receipt.totalCards || 0} --> $ ${cardAmountStr}</span>
                        </div>
                        <div class="summary-row">
                            <span>Total Donations:</span>
                            <span>${receipt.totalDonations || 0} --> $ ${donationAmountStr}</span>
                        </div>
                        <div class="summary-row total">
                            <span>Total Amount:</span>
                            <span>$${Number(receipt.totalAmount || 0).toFixed(2)}</span>
                        </div>
                    </div>

                    <div class="footer">
                        <p>Thank you for supporting Scout Fundraising!</p>
                        <p>Troop 242</p>
                    </div>
                </div>
            </body>
            </html>
        `;
        return html;
    }

    generateSalesSummary(sales) {
        const summary = {};

        sales.forEach(sale => {
            const type = sale.type === 'card' ? 'Card Pack' : 'Donation';
            const paymentMethod = sale.paymentMethod || 'Cash';
            const qty = Number(sale.qty || 1);
            const amount = Number(sale.amount || 0);
            const key = `${type}|${paymentMethod}`;

            if (!summary[key]) {
                summary[key] = {
                    type: type,
                    paymentMethod: paymentMethod,
                    count: 0,
                    totalAmount: 0
                };
            }

            summary[key].count += Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 1;
            summary[key].totalAmount += amount;
        });

        // Sort by type (Card Pack first, then Donation), then by payment method
        const sorted = Object.values(summary).sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === 'Card Pack' ? -1 : 1;
            }
            return a.paymentMethod.localeCompare(b.paymentMethod);
        });

        // Convert back to object with sorted keys
        const sortedSummary = {};
        sorted.forEach((item, idx) => {
            sortedSummary[`${idx}_${item.type}_${item.paymentMethod}`] = item;
        });

        return sortedSummary;
    }

    printReceipt(receipt) {
        const html = this.generateReceiptHTML(receipt);
        const printWindow = window.open('', '', 'height=600,width=800');
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.print();
    }

    downloadReceiptPDF(receipt) {
        const html = this.generateReceiptHTML(receipt);
        const printWindow = window.open('', '', 'height=600,width=800');
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.print();
    }

    generateShareLink(receiptId) {
        const url = new URL(window.location.href);
        url.searchParams.set('receipt', receiptId);
        return url.toString();
    }

    generateQRCode(receiptId) {
        const shareLink = this.generateShareLink(receiptId);
        return shareLink;
    }

    async shareViaEmail(receipt, email) {
        try {
            const apiUrl = new URL('api/send-receipt', window.location.href);
            if (window.location.hostname.endsWith('github.io')) {
                const subject = encodeURIComponent(`Scout Fundraiser Receipt ${receipt.receiptNumber || ''}`.trim());
                const body = encodeURIComponent(`Receipt link: ${this.generateShareLink(receipt.id || receipt.receiptId || '')}`);
                window.location.href = `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`;
                return true;
            }

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    receipientEmail: email,
                    receipt: receipt,
                    receiptHTML: this.generateReceiptHTML(receipt)
                })
            });
            if (!response.ok) throw new Error('Failed to send email');
            return true;
        } catch (error) {
            console.error('Error sending receipt via email:', error);
            return false;
        }
    }

    async shareViaLink(receiptId) {
        const link = this.generateShareLink(receiptId);
        if (navigator.share) {
            try {
                await navigator.share({
                    title: 'Scout Fundraiser Receipt',
                    text: 'Check out my fundraising receipt!',
                    url: link
                });
                return true;
            } catch (error) {
                console.error('Error sharing:', error);
                return false;
            }
        } else {
            // Fallback: copy to clipboard
            navigator.clipboard.writeText(link).then(() => {
                alert('Share link copied to clipboard!');
                return true;
            }).catch(err => {
                console.error('Failed to copy:', err);
                return false;
            });
        }
    }
}
