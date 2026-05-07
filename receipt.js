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
            cardsTakenFromTroop: scoutInfo.cardsTakenFromTroop || 0,
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
        const receiptDate = new Date(receipt.date || receipt.createdAt || Date.now());
        const dateStr = receiptDate.toLocaleDateString('en-US', {
            month: '2-digit',
            day: '2-digit',
            year: '2-digit'
        });

        const dueDate = new Date(receiptDate);
        dueDate.setDate(dueDate.getDate() + 30);
        const dueDateStr = dueDate.toLocaleDateString('en-US', {
            month: '2-digit',
            day: '2-digit',
            year: '2-digit'
        });

        const cardAmount = receipt.cardAmount || 0;
        const donationAmount = receipt.donationAmount || 0;
        const totalAmount = receipt.totalAmount || 0;
        const troopName = receipt.troopInfo?.troopName || receipt.troopName || 'Troop 242';
        const scoutName = receipt.scoutName || 'Scout Name';

        // Group sales by type and payment method and calculate totals
        const grouped = {};
        (receipt.sales || []).forEach(sale => {
            const type = sale.type === 'card' ? 'Camp Card Pack' : 'Donations';
            const payment = sale.paymentMethod || 'Cash';
            const key = `${type}|${payment}`;

            if (!grouped[key]) {
                grouped[key] = { type, payment, total: 0, count: 0 };
            }
            grouped[key].total += Number(sale.amount || 0);
            grouped[key].count += 1;
        });

        // Generate grouped summary rows (sorted by type, then payment method)
        let itemRows = '';
        const sortedGroups = Object.values(grouped).sort((a, b) => {
            // Sort by type first (Camp Card Pack before Donation)
            if (a.type !== b.type) {
                return a.type === 'Camp Card Pack' ? -1 : 1;
            }
            // Then sort by payment method alphabetically
            return a.payment.localeCompare(b.payment);
        });

        sortedGroups.forEach(group => {
            itemRows += `
            <tr>
                <td class="item-cell">${group.type} - ${group.payment}</td>
                <td class="qty-cell">${group.count}</td>
                <td class="amount-cell">$${group.total.toFixed(2)}</td>
            </tr>
            `;
        });

        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Invoice ${receipt.receiptNumber}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { width: 100%; margin: 0; padding: 0; }
        body { font-family: 'Segoe UI', Arial, sans-serif; color: #333; background: white; }
        .page { width: 8.5in; height: 11in; margin: 0 auto; background: white; box-shadow: 0 0 20px rgba(0,0,0,0.1); }
        .header {
            background: linear-gradient(135deg, #1e5a96 0%, #2d7cb5 100%);
            color: white;
            padding: 20px;
            display: grid;
            grid-template-columns: 1fr 1fr;
            /* // gap: 10px; */
        }
        .header-left h1 { font-size: 42px; font-weight: 300; letter-spacing: 2px; margin: 0; }
        .header-left .logo { width: 80px; height: 80px;  }
        .header-right { text-align: right; font-size: 13px; line-height: 1.8; }
        .header-right strong { display: block; font-size: 16px; font-weight: 600; margin-bottom: 8px; }
        .content { padding: 10px; }
        .bill-to { margin-bottom: 10px; }
        .bill-to label { font-size: 12px; font-weight: 700; color: #666; text-transform: uppercase; letter-spacing: 1px; }
        .bill-to .name { font-size: 16px; font-weight: 600; color: #111; margin-top: 5px; }
        .bill-to .details { font-size: 13px; color: #555; margin-top: 5px; line-height: 1.6; }
        .invoice-meta { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 5px; margin-bottom: 5px; }
        .meta-item label { font-size: 11px; font-weight: 700; color: #999; text-transform: uppercase; letter-spacing: 0.5px; }
        .meta-item value { font-size: 14px; font-weight: 600; color: #111; margin-top: 3px; display: block; }
        table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 12px; }
        table thead { background: #1e5a96; color: white; }
        table th { padding: 12px 8px; text-align: left; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
        table td { padding: 12px 8px; border-bottom: 1px solid #e0e0e0; }
        table tbody tr:nth-child(odd) { background: #f9f9f9; }
        .qty-cell, .price-cell, .tax-cell, .amount-cell { text-align: right; }
        .item-cell { text-align: left; }
        .subtotal-row td { background: #d4e6f1; color: #1e5a96; font-weight: 700; font-size: 12px; border-bottom: none; }
        .earnings-row td { background: #1e7a3c; color: white; font-weight: 700; font-size: 14px; border-bottom: none; padding: 14px 8px; }
        .notes { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 20px; margin-top: 10px; }
        .notes-box { background: #d4e6f1; padding: 15px; border-radius: 4px; }
        .notes-box label { font-size: 11px; font-weight: 700; color: #1e5a96; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 8px; }
        .notes-box p { font-size: 12px; color: #333; line-height: 1.5; }
        .totals-box { background: #1e5a96; color: white; padding: 15px; border-radius: 4px; }
        .total-row { display: grid; grid-template-columns: 1fr auto; gap: 15px; margin-bottom: 8px; font-size: 13px; }
        .total-row:last-child { margin-bottom: 0; font-size: 18px; font-weight: 700; }
        .footer { text-align: center; font-size: 10px; color: #999; margin-top: 20px; padding-top: 15px; border-top: 1px solid #e0e0e0; }
        @media print {
            body { background: white; }
            .page { box-shadow: none; width: 100%; height: 100%; margin: 0; }
        }
    </style>
</head>
<body>
    <div class="page">
        <div class="header">
            <div class="header-left">
                <h1>💝 Receipt</h1>
            </div>
            <div class="header-right">
                <strong>${scoutName}</strong>
                Troop 242 - Scout Fundraiser<br>
                Camp Cards - 2026
            </div>
        </div>

        <div class="content">
            <div class="invoice-meta">
                <div class="meta-item">
                    <label>RECEIPT #</label>
                    <value>${receipt.receiptNumber || 'N/A'}</value>
                </div>
                <div class="meta-item">
                    <label>DATE</label>
                    <value>${dateStr}</value>
                </div>
            </div> 
            <div class=divider style="height:1px;background:#e0e0e0;margin:20px 0;"></div>
            <div class="invoice-meta">
                <div class="meta-item">
                    <label>Total Cards taken</label>
                    <value>${receipt.cardsTakenFromTroop || 0}</value>
                </div>   
                <div class="meta-item">
                    <label>Total Cards Sold</label>
                    <value>${receipt.totalCards || 0}</value>
                </div>
                 <div class="meta-item">
                    <label>Total Donations</label>
                    <value>${receipt.totalDonations || 0}</value>
                </div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th style="width: 50%;">DESCRIPTION</th>
                        <th style="width: 20%; text-align: right;">QUANTITY</th>
                        <th style="width: 30%; text-align: right;">AMOUNT</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemRows}
                </tbody>
                <tfoot>
                    <tr class="subtotal-row">
                        <td class="item-cell">Camp Card Pack Subtotal</td>
                        <td class="qty-cell">${receipt.totalCards || 0} cards</td>
                        <td class="amount-cell">$${cardAmount.toFixed(2)}</td>
                    </tr>
                    <tr class="subtotal-row">
                        <td class="item-cell">Donations Subtotal</td>
                        <td class="qty-cell">${receipt.totalDonations || 0}</td>
                        <td class="amount-cell">$${donationAmount.toFixed(2)}</td>
                    </tr>
                    <tr class="earnings-row">
                        <td class="item-cell">🏅 Scout Earnings &nbsp;<span style="font-size:11px;font-weight:400;opacity:0.85;">(${receipt.totalCards || 0} cards × $4.50 + donations)</span></td>
                        <td class="qty-cell"></td>
                        <td class="amount-cell">$${((Number(receipt.totalCards || 0) * 4.50) + donationAmount).toFixed(2)}</td>
                    </tr>
                </tfoot>
            </table>

            <div class="notes">
                <div class="notes-box">
                    <label>NOTES:</label>
                    <p>Thank you for supporting our scout fundraiser. All proceeds support our troop's activities and community service projects.</p>
                </div>
                <div class="totals-box">
                    <div class="total-row">
                        <span>TOTAL</span>
                        <span>$${totalAmount.toFixed(2)}</span>
                    </div>
                </div>
            </div>

            <div class="footer">
                Powered by ScoutFundraiser app<br>
                This receipt was generated by ScoutFundraiser app<br>
                For more information, reach out to webmaster
            </div>
        </div>
    </div>
</body>
</html>`;
    }

    generateSalesSummary(sales) {
        const summary = {};

        sales.forEach(sale => {
            const type = sale.type === 'card' ? 'Card Pack' : 'Donations';
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

    generateReceiptPDFHTML(receipt) {
        const receiptDate = new Date(receipt.date || receipt.createdAt || Date.now());
        const dateStr = receiptDate.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: '2-digit'
        });
        const troopName = receipt.troopInfo?.troopName || receipt.troopName || '';

        const sortedSales = [...(receipt.sales || [])].sort((a, b) => {
            if (a.type !== b.type) return a.type === 'card' ? -1 : 1;
            const da = new Date(a.date || a.createdAtClient || 0).getTime();
            const db = new Date(b.date || b.createdAtClient || 0).getTime();
            return da - db;
        });

        const detailRows = sortedSales.map((sale, idx) => {
            const qty = sale.type === 'card' ? (sale.qty || 1) : 1;
            const desc = sale.type === 'card' ? 'Scout Card' : 'Donation';
            const bg = idx % 2 === 0 ? '' : 'background:#f7f7f7;';
            return `<tr style="${bg}"><td style="padding:4px 8px;border-bottom:1px solid #eee;">${desc}</td><td style="padding:4px 8px;text-align:center;border-bottom:1px solid #eee;">${qty}</td><td style="padding:4px 8px;text-align:right;border-bottom:1px solid #eee;white-space:nowrap;">$${Number(sale.amount || 0).toFixed(2)}</td></tr>`;
        }).join('');

        const completeRows = sortedSales.map((sale, idx) => {
            const bg = idx % 2 === 0 ? '' : 'background:#f7f7f7;';
            const rawDate = sale.date || sale.createdAtClient || '';
            const saleDateStr = rawDate
                ? new Date(rawDate).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' })
                : '-';
            return `<tr style="${bg}">
                <td style="padding:3px 8px;border-bottom:1px solid #eee;">${idx + 1}</td>
                <td style="padding:3px 8px;border-bottom:1px solid #eee;">${sale.type === 'card' ? 'Card' : 'Donation'}</td>
                <td style="padding:3px 8px;border-bottom:1px solid #eee;">${sale.customerName || sale.customer || sale.scoutName || '-'}</td>
                <td style="padding:3px 8px;text-align:center;border-bottom:1px solid #eee;">${sale.qty || 1}</td>
                <td style="padding:3px 8px;text-align:right;border-bottom:1px solid #eee;white-space:nowrap;">$${Number(sale.amount || 0).toFixed(2)}</td>
                <td style="padding:3px 8px;border-bottom:1px solid #eee;">${sale.paymentMethod || sale.payment || '-'}</td>
                <td style="padding:3px 8px;border-bottom:1px solid #eee;">${saleDateStr}</td>
            </tr>`;
        }).join('');

        return `
            <div style="font-family:Arial,sans-serif;font-size:12px;line-height:1.4;color:#000;background:#fff;padding:0;">
                <div style="padding:32px;border:3px solid #003366;border-radius:8px;box-sizing:border-box;margin-bottom:24px;">
                    <div style="text-align:center;margin-bottom:24px;">
                        <div style="font-size:12px;color:#888;letter-spacing:3px;text-transform:uppercase;margin-bottom:12px;">Official Fundraiser Receipt</div>
                        <h1 style="color:#003366;font-size:24px;margin:0 0 6px 0;line-height:1.3;word-wrap:break-word;overflow:hidden;">Receipt for Camp Cards 2026</h1>
                        <div style="width:60px;height:3px;background:#003366;margin:10px auto;"></div>
                        <h2 style="color:#333;font-size:20px;margin:0;font-weight:normal;">by ${receipt.scoutName || 'Scout'}</h2>
                    </div>
                    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:18px;">
                        <tr><td style="padding:6px 10px;width:180px;border-bottom:1px solid #eee;"><strong>Receipt Number:</strong></td><td style="padding:6px 10px;border-bottom:1px solid #eee;">${receipt.receiptNumber || 'N/A'}</td></tr>
                        <tr style="background:#f7f7f7;"><td style="padding:6px 10px;border-bottom:1px solid #eee;"><strong>Scout Name:</strong></td><td style="padding:6px 10px;border-bottom:1px solid #eee;">${receipt.scoutName || ''}</td></tr>
                        <tr><td style="padding:6px 10px;border-bottom:1px solid #eee;"><strong>Troop:</strong></td><td style="padding:6px 10px;border-bottom:1px solid #eee;">${troopName || 'Troop 242'}</td></tr>
                        <tr style="background:#f7f7f7;"><td style="padding:6px 10px;border-bottom:1px solid #eee;"><strong>Date:</strong></td><td style="padding:6px 10px;border-bottom:1px solid #eee;">${dateStr}</td></tr>
                    </table>
                    <table style="width:100%;border-collapse:collapse;font-size:13px;">
                        <tr><td style="padding:6px 10px;width:180px;border-bottom:1px solid #eee;"><strong>Total Cards Sold:</strong></td><td style="padding:6px 10px;border-bottom:1px solid #eee;">${receipt.totalCards || 0}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;color:#003366;font-weight:bold;white-space:nowrap;">$${Number(receipt.cardAmount || 0).toFixed(2)}</td></tr>
                        <tr style="background:#f7f7f7;"><td style="padding:6px 10px;border-bottom:1px solid #eee;"><strong>Total Donations:</strong></td><td style="padding:6px 10px;border-bottom:1px solid #eee;">${receipt.totalDonations || 0}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;color:#003366;font-weight:bold;white-space:nowrap;">$${Number(receipt.donationAmount || 0).toFixed(2)}</td></tr>
                        <tr style="background:#003366;color:white;"><td style="padding:8px 10px;font-weight:bold;font-size:15px;">TOTAL RAISED:</td><td style="padding:8px 10px;"></td><td style="padding:8px 10px;text-align:right;font-weight:bold;font-size:15px;white-space:nowrap;">$${Number(receipt.totalAmount || 0).toFixed(2)}</td></tr>
                    </table>
                </div>
                <div style="text-align:center;margin-top:24px;padding-top:12px;border-top:1px solid #ddd;font-size:10px;color:#666;line-height:1.6;">
                    <strong>Troop 242 Scout Fundraiser • 2026</strong>
                    <div style="margin-top:4px;font-size:9px;">Thank you for supporting our scouts!</div>
                </div>
            </div>

            <div style="page-break-before:always;padding:20px 15px;font-family:Arial,sans-serif;font-size:11px;line-height:1.4;color:#000;background:#fff;">
                <h2 style="text-align:center;color:#003366;font-size:18px;margin:0 0 20px 0;border-bottom:2px solid #003366;padding-bottom:10px;">RECEIPT DETAILS</h2>
                <table style="width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:20px;">
                    <colgroup><col style="width:55%;"><col style="width:15%;"><col style="width:30%;"></colgroup>
                    <thead>
                        <tr style="background:#003366;color:white;">
                            <th style="padding:8px;text-align:left;border:1px solid #003366;">Description</th>
                            <th style="padding:8px;text-align:center;border:1px solid #003366;">Qty</th>
                            <th style="padding:8px;text-align:right;border:1px solid #003366;">Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${detailRows}
                    </tbody>
                </table>
                <table style="width:100%;border-collapse:collapse;margin-bottom:30px;">
                    <tr style="background:#f0f0f0;"><td style="padding:6px 8px;text-align:right;font-weight:bold;border:1px solid #ddd;">Cards Total:</td><td style="padding:6px 8px;text-align:right;font-weight:bold;border:1px solid #ddd;">$${Number(receipt.cardAmount || 0).toFixed(2)}</td></tr>
                    <tr><td style="padding:6px 8px;text-align:right;font-weight:bold;border:1px solid #ddd;">Donations Total:</td><td style="padding:6px 8px;text-align:right;font-weight:bold;border:1px solid #ddd;">$${Number(receipt.donationAmount || 0).toFixed(2)}</td></tr>
                    <tr style="background:#003366;color:white;"><td style="padding:8px;text-align:right;font-weight:bold;border:1px solid #003366;">TOTAL:</td><td style="padding:8px;text-align:right;font-weight:bold;border:1px solid #003366;">$${Number(receipt.totalAmount || 0).toFixed(2)}</td></tr>
                </table>
            </div>

            <div style="page-break-before:always;padding:20px 15px;font-family:Arial,sans-serif;font-size:10px;line-height:1.4;color:#000;background:#fff;">
                <h2 style="text-align:center;color:#003366;font-size:18px;margin:0 0 20px 0;border-bottom:2px solid #003366;padding-bottom:10px;">COMPLETE TRANSACTIONS</h2>
                <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
                    <colgroup><col style="width:5%;"><col style="width:10%;"><col style="width:25%;"><col style="width:8%;"><col style="width:12%;"><col style="width:15%;"><col style="width:25%;"></colgroup>
                    <thead>
                        <tr style="background:#003366;color:white;">
                            <th style="padding:6px 4px;text-align:center;border:1px solid #003366;font-weight:bold;">Line</th>
                            <th style="padding:6px 4px;text-align:left;border:1px solid #003366;font-weight:bold;">Type</th>
                            <th style="padding:6px 4px;text-align:left;border:1px solid #003366;font-weight:bold;">Customer</th>
                            <th style="padding:6px 4px;text-align:center;border:1px solid #003366;font-weight:bold;">Qty</th>
                            <th style="padding:6px 4px;text-align:right;border:1px solid #003366;font-weight:bold;">Amount</th>
                            <th style="padding:6px 4px;text-align:left;border:1px solid #003366;font-weight:bold;">Payment</th>
                            <th style="padding:6px 4px;text-align:left;border:1px solid #003366;font-weight:bold;">Date</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${completeRows}
                    </tbody>
                </table>
                <div style="margin-top:20px;text-align:center;font-size:9px;color:#666;border-top:1px solid #ddd;padding-top:10px;">
                    <strong>Troop 242 Scout Fundraiser • 2026</strong><br>
                    Thank you for supporting our scouts!
                </div>
            </div>
        `;
    }

    downloadReceiptPDF(receipt) {
        if (!receipt) { alert('Receipt data not found'); return; }
        if (!window.html2pdf) { alert('PDF export library is still loading. Please try again.'); return; }

        const body = this.generateReceiptPDFHTML(receipt);

        // Wrap in a full self-contained HTML document.
        // Pass as 'string' so html2pdf renders it in its own isolated container —
        // avoids all app CSS interference and blank-canvas issues with DOM injection.
        const fullHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #fff; font-family: Arial, sans-serif; font-size: 12px; color: #000; }
</style>
</head>
<body style="background:#fff;"><div style="width:718px;background:#fff;box-sizing:border-box;">${body}</div></body>
</html>`;

        const opt = {
                margin: [10, 10, 10, 10],
                filename: `Receipt_${receipt.receiptNumber || receipt.id}_${new Date().toISOString().split('T')[0]}.pdf`,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2, useCORS: true, logging: false, scrollX: 0, scrollY: 0, windowWidth: 718 },
                jsPDF: { orientation: 'portrait', unit: 'mm', format: 'a4' }
        };

        html2pdf().set(opt).from(fullHtml, 'string').save().catch((error) => {
            console.error('[PDF] Error:', error);
            alert('Error generating PDF: ' + error.message);
        });
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
