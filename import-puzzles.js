/**
 * Migration script to import puzzles from Google Sheets CSV to Supabase
 * Run with: node import-puzzles.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env file');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRVce17rCXo1SJkPhMK0R1P4ytJAG5In25KcP66a5aNE4KEtg7u_0oQGuQzgL3-MiGUdI0_4BmQXGYK/pub?output=csv';

// Parse CSV handling quoted fields
function parseCSV(text) {
    const lines = text.trim().split('\n');
    const result = [];

    for (const line of lines) {
        const row = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                row.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        row.push(current.trim());
        result.push(row);
    }
    return result;
}

// Normalize date to YYYY-MM-DD format
function normalizeDate(dateStr) {
    if (!dateStr) return null;

    // Already in YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return dateStr;
    }

    // MM/DD/YYYY format
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) {
        const parts = dateStr.split('/');
        const month = parts[0].padStart(2, '0');
        const day = parts[1].padStart(2, '0');
        const year = parts[2];
        return `${year}-${month}-${day}`;
    }

    // DD/MM/YYYY format (British)
    if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(dateStr)) {
        const parts = dateStr.split('-');
        const day = parts[0].padStart(2, '0');
        const month = parts[1].padStart(2, '0');
        const year = parts[2];
        return `${year}-${month}-${day}`;
    }

    // Excel serial date number
    if (!isNaN(dateStr) && Number(dateStr) > 40000) {
        const excelDate = new Date((Number(dateStr) - 25569) * 86400 * 1000);
        const year = excelDate.getFullYear();
        const month = String(excelDate.getMonth() + 1).padStart(2, '0');
        const day = String(excelDate.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    return null;
}

// Parse words from comma-separated string
function parseWords(str) {
    if (!str) return [];
    return String(str).split(',').map(w => w.trim().toUpperCase()).filter(w => w);
}

async function importPuzzles() {
    console.log('Fetching puzzles from Google Sheets...');

    try {
        const response = await fetch(SHEET_URL);
        if (!response.ok) {
            throw new Error(`Failed to fetch CSV: ${response.status}`);
        }

        const text = await response.text();
        const data = parseCSV(text);

        console.log(`Parsed ${data.length - 1} rows from CSV (excluding header)`);

        let successCount = 0;
        let skipCount = 0;
        let errorCount = 0;

        // Skip header row (index 0)
        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            if (!row || !row[0]) {
                console.log(`Row ${i}: SKIP - Empty row`);
                skipCount++;
                continue;
            }

            const date = normalizeDate(String(row[0]));
            if (!date) {
                console.log(`Row ${i}: SKIP - Invalid date: ${row[0]}`);
                skipCount++;
                continue;
            }

            // Check if puzzle already exists
            const { data: existing } = await supabase
                .from('puzzles')
                .select('id')
                .eq('date', date)
                .single();

            if (existing) {
                console.log(`Row ${i}: SKIP - Puzzle for ${date} already exists`);
                skipCount++;
                continue;
            }

            // Build categories array
            const categories = [
                {
                    title: row[1] || '',
                    difficulty: 1,
                    words: parseWords(row[2])
                },
                {
                    title: row[3] || '',
                    difficulty: 2,
                    words: parseWords(row[4])
                },
                {
                    title: row[5] || '',
                    difficulty: 3,
                    words: parseWords(row[6])
                },
                {
                    title: row[7] || '',
                    difficulty: 4,
                    words: parseWords(row[8])
                }
            ];

            // Validate categories have 4 words each
            const invalidCategories = categories.filter(c => c.words.length !== 4);
            if (invalidCategories.length > 0) {
                console.log(`Row ${i}: SKIP - ${date} has categories with != 4 words`);
                skipCount++;
                continue;
            }

            // Insert into Supabase
            const { error } = await supabase
                .from('puzzles')
                .insert({
                    date,
                    categories
                });

            if (error) {
                console.log(`Row ${i}: ERROR - ${date}: ${error.message}`);
                errorCount++;
            } else {
                console.log(`Row ${i}: SUCCESS - Imported puzzle for ${date}`);
                successCount++;
            }
        }

        console.log('\n===== IMPORT COMPLETE =====');
        console.log(`Success: ${successCount}`);
        console.log(`Skipped: ${skipCount}`);
        console.log(`Errors: ${errorCount}`);

    } catch (error) {
        console.error('Import failed:', error.message);
        process.exit(1);
    }
}

importPuzzles();
