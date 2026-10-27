const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const sampleProducts = [
  {
    Name: 'Fortune Sunlite Refined Sunflower Oil',
    Description: 'Rich in vitamins A and D, healthy edible cooking oil for everyday dishes',
    SKU: 'FORT-SUN-1L',
    MRP: 160.0,
    SellingPrice: 145.0,
    Unit: 'L',
    Weight: 1.0,
    InitialStock: 50,
    ImageUrl: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=500',
    Images: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=500',
  },
  {
    Name: 'Tata Salt Vacuum Evaporated',
    Description: 'Iodized salt with essential minerals and vacuum purity',
    SKU: 'TATA-SALT-1KG',
    MRP: 30.0,
    SellingPrice: 28.0,
    Unit: 'KG',
    Weight: 1.0,
    InitialStock: 120,
    ImageUrl: 'https://images.unsplash.com/photo-1518110925495-5fe2fda0442c?w=500',
    Images: '',
  },
  {
    Name: 'Aashirvaad Superior MP Sharbati Atta',
    Description: '100% pure whole wheat stone ground flour for extra soft rotis',
    SKU: 'AASH-ATTA-5KG',
    MRP: 290.0,
    SellingPrice: 265.0,
    Unit: 'KG',
    Weight: 5.0,
    InitialStock: 40,
    ImageUrl: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=500',
    Images: '',
  },
  {
    Name: 'Amul Butter Pasteurized',
    Description: 'Utterly butterly delicious creamy salted butter',
    SKU: 'AMUL-BUTTER-500G',
    MRP: 275.0,
    SellingPrice: 260.0,
    Unit: 'G',
    Weight: 500,
    InitialStock: 75,
    ImageUrl: 'https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?w=500',
    Images: '',
  },
  {
    Name: 'Nestle Everyday Dairy Whitener',
    Description: 'Rich and creamy milk powder for perfect tea and coffee',
    SKU: 'NEST-EDAY-400G',
    MRP: 240.0,
    SellingPrice: 220.0,
    Unit: 'G',
    Weight: 400,
    InitialStock: 60,
    ImageUrl: 'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=500',
    Images: '',
  },
  {
    Name: 'Cadbury Dairy Milk Silk Chocolate',
    Description: 'Classic smooth and creamy melt-in-mouth milk chocolate bar',
    SKU: 'CADB-SILK-150G',
    MRP: 175.0,
    SellingPrice: 160.0,
    Unit: 'G',
    Weight: 150,
    InitialStock: 90,
    ImageUrl: 'https://images.unsplash.com/photo-1549007994-cb92caebd54b?w=500',
    Images: '',
  },
  {
    Name: 'Bru Instant Coffee Powder',
    Description: 'Aromatic blend of selected Arabica and Robusta coffee beans',
    SKU: 'BRU-INST-200G',
    MRP: 320.0,
    SellingPrice: 295.0,
    Unit: 'G',
    Weight: 200,
    InitialStock: 45,
    ImageUrl: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=500',
    Images: '',
  },
  {
    Name: 'Dettol Original Liquid Handwash Refill',
    Description: '100% better germ protection antibacterial liquid soap pouch',
    SKU: 'DETT-HW-750ML',
    MRP: 119.0,
    SellingPrice: 99.0,
    Unit: 'ML',
    Weight: 750,
    InitialStock: 80,
    ImageUrl: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500',
    Images: '',
  },
  {
    Name: "Haldiram's Nagpur Bhujia Sev",
    Description: 'Authentic crispy spicy gram flour noodles traditional Indian snack',
    SKU: 'HALD-BHUJ-400G',
    MRP: 120.0,
    SellingPrice: 105.0,
    Unit: 'G',
    Weight: 400,
    InitialStock: 65,
    ImageUrl: 'https://images.unsplash.com/photo-1599490659213-e2b9527bd087?w=500',
    Images: '',
  },
  {
    Name: 'Surf Excel Matic Top Load Detergent Liquid',
    Description: 'Superior stain removal liquid detergent specially formulated for washing machines',
    SKU: 'SURF-MAT-1L',
    MRP: 230.0,
    SellingPrice: 205.0,
    Unit: 'L',
    Weight: 1.0,
    InitialStock: 35,
    ImageUrl: 'https://images.unsplash.com/photo-1610557892470-55d9e80c0bce?w=500',
    Images: '',
  },
];

const worksheet = xlsx.utils.json_to_sheet(sampleProducts);

// Set nice column widths for Excel
worksheet['!cols'] = [
  { wch: 38 }, // Name
  { wch: 55 }, // Description
  { wch: 18 }, // SKU
  { wch: 10 }, // MRP
  { wch: 14 }, // SellingPrice
  { wch: 8 },  // Unit
  { wch: 10 }, // Weight
  { wch: 14 }, // InitialStock
  { wch: 45 }, // ImageUrl
  { wch: 45 }, // Images
];

const workbook = xlsx.utils.book_new();
xlsx.utils.book_append_sheet(workbook, worksheet, 'Products');

const targetXlsxPath = path.join(__dirname, '..', 'dummy_products_bulk_import.xlsx');
xlsx.writeFile(workbook, targetXlsxPath);
console.log(`Successfully generated Excel file at: ${targetXlsxPath}`);

// Also create a CSV version for convenience
const targetCsvPath = path.join(__dirname, '..', 'dummy_products_bulk_import.csv');
const csvContent = xlsx.utils.sheet_to_csv(worksheet);
fs.writeFileSync(targetCsvPath, csvContent, 'utf-8');
console.log(`Successfully generated CSV file at: ${targetCsvPath}`);
