/**
 * @fileoverview This module contains the logic for transforming a raw product object
 * from the OpenFoodFacts JSONL data dump into the structured format
 * required for our database. This ensures consistent data processing across
 * both the initial import and subsequent delta updates.
 */

/**
 * Transforms a single line of raw JSONL data into a structured product object.
 * It extracts relevant fields, computes derived values like `search_text`,
 * and handles missing or malformed data gracefully.
 *
 * @param {string} line A raw JSON string representing a single product from the OFF dump.
 * @returns {object | null} A structured product object ready for database insertion,
 * or null if the line is invalid or represents an incomplete product record
 * that should be skipped.
 */
function transformProduct(line) {
  if (!line) return null;

  try {
    const p = JSON.parse(line);
    // Basic validation: ensure the product has a code and a name.
    if (!p.code || !p.product_name) {
      return null;
    }

    const searchTextParts = [
      p.product_name,
      p.brands,
      p.code,
      p.categories_tags?.join(' '),
      p.labels_tags?.join(' '),
    ];

    const nutriments = p.nutriments || {};
    const energy = nutriments['energy-kcal_100g'];
    const fat = nutriments.fat_100g;
    const carbs = nutriments.carbohydrates_100g;
    const proteins = nutriments.proteins_100g;
    
    // Determine completeness based on key nutritional data and a completeness score > 0.8
    const hasMacros = energy != null && fat != null && carbs != null && proteins != null;
    const isComplete = hasMacros && p.completeness != null && p.completeness > 0.8;

    const productData = {
      id: p.code,
      code: p.code,
      product_name: p.product_name || null,
      brands: p.brands || null,
      categories: p.categories || null,
      countries: p.countries || null,
      energy_kcal: energy || null,
      fat_100g: fat || null,
      saturated_fat_100g: nutriments['saturated-fat_100g'] || null,
      carbohydrates_100g: carbs || null,
      sugars_100g: nutriments.sugars_100g || null,
      proteins_100g: proteins || null,
      salt_100g: nutriments.salt_100g || null,
      fiber_100g: nutriments.fiber_100g || null,
      nutriscore_grade: p.nutriscore_grade || null,
      nova_group: p.nova_group || null,
      ecoscore_grade: p.ecoscore_grade || null,
      completeness: isComplete ? 1.0 : (p.completeness || 0.0),
      last_modified_t: p.last_modified_t || null,
      raw_data: line,
      search_text: searchTextParts.filter(Boolean).join(' '),
    };

    return productData;
  } catch (error) {
    // Malformed JSON, skip line by returning null.
    // console.error('Failed to parse line:', line, error);
    return null;
  }
}

module.exports = {
  transformProduct,
}; 