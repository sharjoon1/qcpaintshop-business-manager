/**
 * Product Pricing Helper Functions
 * Handles GST-inclusive pricing calculations
 */

/**
 * Calculate GST breakdown from inclusive price
 * @param {number} inclusivePrice - Final price including GST
 * @param {number} gstPercent - GST percentage (e.g., 18 for 18%)
 * @returns {object} - { basePrice, gstAmount, finalPrice }
 */
function calculateGSTBreakdown(inclusivePrice, gstPercent) {
  const finalPrice = parseFloat(inclusivePrice);
  const gstRate = parseFloat(gstPercent) / 100;
  
  // Reverse calculate base price from GST-inclusive price
  // Formula: Base Price = Final Price / (1 + GST%)
  const basePrice = finalPrice / (1 + gstRate);
  const gstAmount = finalPrice - basePrice;
  
  return {
    basePrice: parseFloat(basePrice.toFixed(2)),
    gstAmount: parseFloat(gstAmount.toFixed(2)),
    finalPrice: parseFloat(finalPrice.toFixed(2))
  };
}

/**
 * Calculate final price from base price (for backward compatibility)
 * @param {number} basePrice - Price before GST
 * @param {number} gstPercent - GST percentage
 * @returns {object} - { basePrice, gstAmount, finalPrice }
 */
function calculateFinalPrice(basePrice, gstPercent) {
  const base = parseFloat(basePrice);
  const gstRate = parseFloat(gstPercent) / 100;
  
  const gstAmount = base * gstRate;
  const finalPrice = base + gstAmount;
  
  return {
    basePrice: parseFloat(base.toFixed(2)),
    gstAmount: parseFloat(gstAmount.toFixed(2)),
    finalPrice: parseFloat(finalPrice.toFixed(2))
  };
}

/**
 * Format pricing display
 * @param {object} breakdown - Result from calculateGSTBreakdown
 * @returns {string} - Formatted string
 */
function formatPricingDisplay(breakdown) {
  return `Final Price: ₹${breakdown.finalPrice} (Base: ₹${breakdown.basePrice} + GST: ₹${breakdown.gstAmount})`;
}

module.exports = {
  calculateGSTBreakdown,
  calculateFinalPrice,
  formatPricingDisplay
};
