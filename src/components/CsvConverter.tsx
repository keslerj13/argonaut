import React, { useState, useRef } from 'react';
import Papa from 'papaparse';
import { Upload, Download, FileText, CheckCircle, AlertCircle, Copy, ChevronDown, ChevronUp } from 'lucide-react';

interface ValidationWarning {
  type: string;
  category: 'schema' | 'data_quality' | 'naming' | 'structure';
  severity: 'critical' | 'warning' | 'info';
  message: string;
  recommendation: string;
  row?: number;
  column?: number;
  details?: string[];
  examples?: string[];
  idealFormat?: string;
}

interface ConversionResult {
  jsonOutput: string;
  fieldCount: number;
  nestedFields: string[];
  dataTypes: string[];
  warnings: ValidationWarning[];
}

const CsvConverter = () => {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [error, setError] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [preAnalysis, setPreAnalysis] = useState<{
    issues: string[];
    structure: {
      totalRows: number;
      declaredNameFound: boolean;
      declaredNameCol: number;
      dataTypeRowFound: boolean;
      dataTypeRow: number;
      dataStartRow: number;
      estimatedDataRows: number;
    };
  } | null>(null);
  const [expandedWarnings, setExpandedWarnings] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const convertValue = (value: string, dataType: string, unit: string) => {
    if (!value || value.trim() === '') return null;

    const trimmedValue = value.trim();
    const lowerDataType = dataType ? dataType.toLowerCase() : '';

    // Handle arrays (values in brackets)
    if (trimmedValue.startsWith('[') && trimmedValue.endsWith(']')) {
      try {
        // First try to parse as valid JSON
        const arrayValue = JSON.parse(trimmedValue);
        return unit && unit.trim() !== '' ? { value: arrayValue, unit: unit.trim() } : arrayValue;
      } catch {
        // If JSON parse fails, try to parse as comma-separated values
        const innerContent = trimmedValue.slice(1, -1); // Remove brackets
        const items = innerContent.split(',').map(item => item.trim());
        return unit && unit.trim() !== '' ? { value: items, unit: unit.trim() } : items;
      }
    }

    // Convert based on data type
    let convertedValue;
    if (lowerDataType.includes('real') || lowerDataType.includes('int')) {
      const num = parseFloat(trimmedValue);
      convertedValue = isNaN(num) ? trimmedValue : num;
    } else if (lowerDataType.includes('string')) {
      convertedValue = trimmedValue;
    } else {
      // Try to auto-detect numeric values
      const num = parseFloat(trimmedValue);
      convertedValue = isNaN(num) ? trimmedValue : num;
    }

    // If there's a unit, create an object with value and unit
    if (unit && unit.trim() !== '') {
      return {
        value: convertedValue,
        unit: unit.trim()
      };
    }

    return convertedValue;
  };

  const processFile = async () => {
    if (!file) {
      setError('Please select a CSV file first');
      return;
    }

    setIsProcessing(true);
    setError('');
    setResult(null);

    try {
      const csvData = await file.text();
      
      // Parse CSV with Papa Parse
      const parsed = Papa.parse(csvData, {
        skipEmptyLines: true,
        dynamicTyping: false, // Keep as strings initially
        delimitersToGuess: [',', '\t', '|', ';']
      });

      if (parsed.errors.length > 0) {
        setError('CSV parsing errors: ' + parsed.errors.map(e => e.message).join(', '));
        return;
      }

      const rows = parsed.data as string[][];
      
      if (rows.length < 3) {
        const errorMsg = `CSV must have at least 3 rows (header rows + at least 1 data row). Your CSV has ${rows.length} rows.`;
        console.error(errorMsg);
        setError(errorMsg);
        setIsProcessing(false);
        return;
      }

      console.log(`CSV has ${rows.length} rows total`);

      // Dynamically detect header structure
      let declaredNameCol = -1;
      let dataStartRow = -1;
      let dataTypeRow = -1;
      let requirementClassRow = -1;
      
      console.log('Starting header detection...');
      console.log('Detecting header structure from CSV rows:', rows.slice(0, 8));
      
      // Find declared_name column and identify important rows
      for (let rowIndex = 0; rowIndex < Math.min(rows.length, 20); rowIndex++) {
        const row = rows[rowIndex];
        
        for (let colIndex = 0; colIndex < row.length; colIndex++) {
          const cell = row[colIndex];
          if (cell && cell.trim() === 'declared_name') {
            declaredNameCol = colIndex;
            console.log(`✓ FOUND declared_name at row ${rowIndex}, col ${colIndex}`);
            break;
          }
        }
        
        // Identify special rows
        const firstCell = row[0]?.toLowerCase().trim() || '';
        if (firstCell.includes('requirement') && firstCell.includes('class')) {
          requirementClassRow = rowIndex;
          console.log(`✓ Found requirement class row at: ${rowIndex}`);
        }
        if (firstCell === 'data type' || firstCell === 'data_type') {
          dataTypeRow = rowIndex;
          console.log(`✓ Found data type row at: ${rowIndex}`);
        }
      }
      
      console.log(`Detection complete: declaredNameCol=${declaredNameCol}, dataTypeRow=${dataTypeRow}, requirementClassRow=${requirementClassRow}`);
        
      // Find where data rows start
      console.log('Detecting where data rows start...');
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex];
        
        // More precise pattern matching: only match exact header keywords
        const hasHeaderPattern = row.some(cell => {
          if (!cell) return false;
          const lower = cell.toLowerCase().trim();
          return (
            lower === 'declared_name' ||
            lower === 'requirement class' ||
            lower === 'data type' ||
            lower === 'data_type' ||
            lower.startsWith('nested_object_') ||
            (lower === 'object' && row[0] === cell) // Only if "Object" is in first column
          );
        });
        
        // Only set dataStartRow if we've moved past header rows
        if (!hasHeaderPattern && dataStartRow === -1 && rowIndex > 2) {
          // Double check this row has actual data (not all empty)
          const hasData = row.some(cell => cell && cell.trim() !== '');
          if (hasData) {
            dataStartRow = rowIndex;
            console.log(`✓ Data rows start at row ${rowIndex}`);
            break;
          }
        }
      }
      
      console.log(`Final detection results:`, { declaredNameCol, dataStartRow, dataTypeRow, requirementClassRow });
      
      // Validate detection results with detailed errors
      if (declaredNameCol === -1) {
        console.error('❌ Could not find declared_name column');
        console.error('Available header data:', rows.slice(0, 8));
        const errorMsg = '❌ Could not find "declared_name" column in CSV headers.\n\n' +
          'Please ensure one of the header cells contains exactly "declared_name".\n\n' +
          `Searched ${Math.min(rows.length, 20)} rows and found no "declared_name" cell.`;
        setError(errorMsg);
        setIsProcessing(false);
        return;
      }
      
      console.log('✓ declared_name column found');
      
      // Check if we have proper structure
      if (dataStartRow === -1) {
        console.warn('⚠️ Could not auto-detect data start row');
        // Count rows that look like headers
        let headerLikeRows = 0;
        for (let i = 0; i < Math.min(rows.length, 15); i++) {
          const hasPattern = rows[i].some(cell => {
            if (!cell) return false;
            const lower = cell.toLowerCase().trim();
            return (
              lower === 'declared_name' ||
              lower === 'requirement class' ||
              lower === 'data type' ||
              lower === 'data_type' ||
              lower.startsWith('nested_object_') ||
              lower === 'object'
            );
          });
          if (hasPattern) headerLikeRows = i + 1;
        }
        
        console.log(`Found ${headerLikeRows} header-like rows`);
        
        if (headerLikeRows > 0 && headerLikeRows < rows.length) {
          dataStartRow = headerLikeRows;
          console.log(`✓ Auto-detected data start at row: ${dataStartRow}`);
        } else {
          console.error('❌ Could not determine data start');
          const errorMsg = `❌ Could not detect where data rows begin.\n\n` +
            `Found ${headerLikeRows} header-like rows but no clear data section.\n\n` +
            `Expected structure:\n` +
            `• Header rows with: Object, nested_object_N, declared_name, requirement_class, data_type\n` +
            `• Then data rows\n\n` +
            `Your CSV has ${rows.length} total rows with unclear structure.`;
          setError(errorMsg);
          setIsProcessing(false);
          return;
        }
      }
      
      console.log('✓ Data start row identified');
      
      // Validate we have enough data
      if (dataStartRow >= rows.length) {
        console.error('❌ No data rows found');
        const errorMsg = `❌ Data section starts at row ${dataStartRow + 1}, but CSV only has ${rows.length} rows.\n\nNo data rows found!`;
        setError(errorMsg);
        setIsProcessing(false);
        return;
      }
      
      const dataRowCount = rows.length - dataStartRow;
      console.log(`✓ Found ${dataRowCount} data rows (rows ${dataStartRow + 1} to ${rows.length})`);
      
      // Validate data type row is before data starts
      if (dataTypeRow !== -1 && dataTypeRow >= dataStartRow) {
        console.error('❌ Data type row is after data starts');
        const errorMsg = `❌ Data Type row found at row ${dataTypeRow + 1}, but data starts at row ${dataStartRow + 1}.\n\nData Type row must come before data rows.`;
        setError(errorMsg);
        setIsProcessing(false);
        return;
      }
      
      console.log('✓ All structure validation passed. Starting conversion...');
      
      // Extract header rows dynamically
      const headerRows = rows.slice(0, dataStartRow);
      const dataRows = rows.slice(dataStartRow);

      // Validation warnings
      const warnings: ValidationWarning[] = [];
      
      // Quality checks before processing
      
      // Check 1: Missing data types
      if (dataTypeRow !== -1) {
        for (let colIndex = 0; colIndex < headerRows[0].length; colIndex++) {
          if (colIndex === declaredNameCol) continue;
          const dataTypeValue = headerRows[dataTypeRow][colIndex];
          const hasData = dataRows.some(row => row[colIndex] && row[colIndex].trim() !== '');
          if (hasData && (!dataTypeValue || dataTypeValue.trim() === '')) {
            const exampleData = dataRows.find(row => row[colIndex] && row[colIndex].trim())![colIndex];
            warnings.push({
              type: 'missing_data_type',
              category: 'schema',
              severity: 'critical',
              message: `Column ${colIndex + 1} has data but no data type specified`,
              recommendation: 'Add data type (real, int, or string) in the data_type row for this column',
              column: colIndex + 1,
              examples: [`Data found: "${exampleData}"`],
              idealFormat: 'Data Type row should contain: "real" or "int" or "string"'
            });
          }
        }
      }
      
      // Check 2: Non-unique declared_name values
      const declaredNames = dataRows
        .map(row => row[declaredNameCol])
        .filter(name => name && name.trim() !== '');
      const duplicates = declaredNames.filter((name, index) => 
        declaredNames.indexOf(name) !== index
      );
      if (duplicates.length > 0) {
        const uniqueDuplicates = [...new Set(duplicates)];
        warnings.push({
          type: 'duplicate_declared_names',
          category: 'naming',
          severity: 'critical',
          message: `${uniqueDuplicates.length} duplicate declared_name value(s) found`,
          recommendation: 'Each declared_name must be unique. Rename duplicates with unique identifiers.',
          details: uniqueDuplicates,
          examples: uniqueDuplicates.slice(0, 3),
          idealFormat: 'declared_name values must be unique across all rows'
        });
      }
      
      // Check 3: declared_name with spaces or invalid characters
      const invalidNames: string[] = [];
      declaredNames.forEach((name, index) => {
        if (/[^\w\-]/.test(name)) {
          invalidNames.push(name);
          warnings.push({
            type: 'invalid_declared_name',
            category: 'naming',
            severity: 'critical',
            message: `Invalid characters in declared_name: "${name}"`,
            recommendation: 'Replace spaces with underscores, remove unicode/special characters',
            row: dataStartRow + index + 1,
            examples: [`"${name}" → "${name.replace(/[^\w\-]/g, '_')}"`],
            idealFormat: 'Use only: letters, numbers, underscores, and hyphens (e.g., "battery_voltage")'
          });
        }
      });
      
      // Check 4: Data with embedded units (like "15 mm")
      const embeddedUnitExamples: string[] = [];
      for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex++) {
        const dataRow = dataRows[rowIndex];
        for (let colIndex = 0; colIndex < dataRow.length; colIndex++) {
          if (colIndex === declaredNameCol) continue;
          const value = dataRow[colIndex];
          if (value && /^\d+\.?\d*\s+(mm|m|cm|km|kg|g|kW|MW|kWh|°C|°F|Hz|kHz|MHz)/.test(value.trim())) {
            const match = value.trim().match(/^(\d+\.?\d*)\s+(\w+)$/);
            if (match && embeddedUnitExamples.length < 3) {
              embeddedUnitExamples.push(`"${value}" → Split into value: ${match[1]}, unit: ${match[2]}`);
            }
            warnings.push({
              type: 'embedded_unit',
              category: 'data_quality',
              severity: 'warning',
              message: `Value "${value}" has embedded unit in cell`,
              recommendation: 'Separate values and units into different columns (value column + unit column)',
              row: dataStartRow + rowIndex + 1,
              column: colIndex + 1,
              examples: embeddedUnitExamples.length > 0 ? [embeddedUnitExamples[0]] : [],
              idealFormat: 'Value column: "15", Unit column: "mm" (separate columns)'
            });
          }
        }
      }
      
      // Check 5: Missing top-level object or skipped nesting levels
      for (let colIndex = 0; colIndex < headerRows[0].length; colIndex++) {
        if (colIndex === declaredNameCol) continue;
        
        const nestingPath: string[] = [];
        for (let headerRowIndex = 0; headerRowIndex < headerRows.length; headerRowIndex++) {
          if (headerRowIndex === requirementClassRow || headerRowIndex === dataTypeRow) continue;
          const headerValue = headerRows[headerRowIndex][colIndex];
          if (headerValue && headerValue.trim() && !headerValue.match(/nested_object_\d+/i)) {
            nestingPath.push(headerValue.trim());
          }
        }
        
        // Check if column has nested objects but no top-level object
        const hasNestedObjectLabel = headerRows.some((row, idx) => 
          idx !== requirementClassRow && 
          idx !== dataTypeRow && 
          row[colIndex] && 
          row[colIndex].match(/nested_object_\d+/i)
        );
        
        if (hasNestedObjectLabel && nestingPath.length === 1) {
          warnings.push({
            type: 'missing_top_level',
            category: 'structure',
            severity: 'warning',
            message: `Column ${colIndex + 1} marked as nested but missing parent object`,
            recommendation: 'Add a top-level object name in the first structure row before nested_object_N',
            column: colIndex + 1,
            examples: [`Current: nested_object_1 → property`],
            idealFormat: 'Should be: ParentObject → nested_object_1 → property'
          });
        }
      }
      
      // Check 6: Inconsistent units in columns labeled with "unit"
      for (let colIndex = 0; colIndex < headerRows[0].length; colIndex++) {
        if (colIndex === declaredNameCol) continue;
        
        // Check if this column has "unit" in its header
        const hasUnitLabel = headerRows.some(row => 
          row[colIndex] && row[colIndex].toLowerCase().includes('unit')
        );
        
        if (hasUnitLabel) {
          const units = dataRows
            .map(row => row[colIndex])
            .filter(val => val && val.trim() !== '')
            .map(val => val.trim());
          
          const uniqueUnits = [...new Set(units)];
          if (uniqueUnits.length > 1) {
            warnings.push({
              type: 'inconsistent_units',
              category: 'data_quality',
              severity: 'warning',
              message: `Column ${colIndex + 1} has mixed units: ${uniqueUnits.join(', ')}`,
              recommendation: 'Standardize all units in this column to a single unit type',
              column: colIndex + 1,
              details: uniqueUnits,
              examples: uniqueUnits.slice(0, 3).map(u => `Found: "${u}"`),
              idealFormat: 'All values in a unit column should use the same unit (e.g., all "mm" or all "m")'
            });
          }
        }
      }
      
      // Check 7: Filled cells in first column under nested_objects list
      for (let headerRowIndex = 0; headerRowIndex < headerRows.length; headerRowIndex++) {
        const firstColValue = headerRows[headerRowIndex][0];
        
        // Only skip specific expected rows
        const isDeclaredNameRow = firstColValue && firstColValue.toLowerCase().trim() === 'declared_name';
        const isRequirementRow = headerRowIndex === requirementClassRow;
        const isDataTypeRow = headerRowIndex === dataTypeRow;
        const isObjectHeaderRow = firstColValue && firstColValue.toLowerCase().trim() === 'object';
        
        // If first column has ANY value in a non-expected row, warn
        if (!isDeclaredNameRow && !isRequirementRow && !isDataTypeRow && !isObjectHeaderRow && firstColValue && firstColValue.trim() !== '') {
          warnings.push({
            type: 'invalid_first_column',
            category: 'structure',
            severity: 'warning',
            message: `Unexpected value "${firstColValue}" in first column of header row ${headerRowIndex + 1}`,
            recommendation: 'First column should only contain: "declared_name", "Requirement Class", "Data Type", or "Object" labels',
            row: headerRowIndex + 1,
            examples: [`Found: "${firstColValue}"`],
            idealFormat: 'First column in structure rows should be empty (except for the 3-4 label rows)'
          });
        }
      }
      
      // Check 8: Value/unit mismatch - find columns with shared nested object
      const valueUnitPairs = new Map<string, { valueCol: number; unitCol: number }>();
      
      for (let colIndex = 0; colIndex < headerRows[0].length; colIndex++) {
        if (colIndex === declaredNameCol) continue;
        
        // Build the path for this column
        const path: string[] = [];
        let isValue = false;
        let isUnit = false;
        
        for (let headerRowIndex = 0; headerRowIndex < headerRows.length; headerRowIndex++) {
          if (headerRowIndex === requirementClassRow || headerRowIndex === dataTypeRow) continue;
          const headerValue = headerRows[headerRowIndex][colIndex];
          if (headerValue && headerValue.trim()) {
            const trimmed = headerValue.trim();
            if (!trimmed.match(/nested_object_\d+/i)) {
              if (trimmed.toLowerCase() === 'value') {
                isValue = true;
              } else if (trimmed.toLowerCase() === 'unit') {
                isUnit = true;
              } else {
                path.push(trimmed);
              }
            }
          }
        }
        
        const pathKey = path.join('|');
        if (pathKey && (isValue || isUnit)) {
          const existing = valueUnitPairs.get(pathKey) || { valueCol: -1, unitCol: -1 };
          if (isValue) existing.valueCol = colIndex;
          if (isUnit) existing.unitCol = colIndex;
          valueUnitPairs.set(pathKey, existing);
        }
      }
      
      // Check for value/unit mismatches
      const mismatchExamples: string[] = [];
      valueUnitPairs.forEach((pair, pathKey) => {
        if (pair.valueCol !== -1 && pair.unitCol !== -1) {
          for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex++) {
            const valueCell = dataRows[rowIndex][pair.valueCol];
            const unitCell = dataRows[rowIndex][pair.unitCol];
            
            const hasValue = valueCell && valueCell.trim() !== '';
            const hasUnit = unitCell && unitCell.trim() !== '';
            
            if (hasValue !== hasUnit) {
              const example = `Row ${dataStartRow + rowIndex + 1}: ${hasValue ? 'has value' : 'empty'} but ${hasUnit ? 'has unit' : 'no unit'}`;
              if (mismatchExamples.length < 3) mismatchExamples.push(example);
              
              warnings.push({
                type: 'value_unit_mismatch',
                category: 'data_quality',
                severity: 'warning',
                message: `Value/unit mismatch in "${pathKey.replace(/\|/g, ' > ')}"`,
                recommendation: 'Ensure both value and unit are filled or both are empty for each row',
                row: dataStartRow + rowIndex + 1,
                details: [`Value: ${hasValue ? 'filled' : 'empty'}, Unit: ${hasUnit ? 'filled' : 'empty'}`],
                examples: mismatchExamples,
                idealFormat: 'Either both value AND unit should be filled, or both should be empty'
              });
            }
          }
        }
      });
      
      // NEW Check 9: Header row structure validation
      const hasRequirementClass = requirementClassRow !== -1;
      const hasDataType = dataTypeRow !== -1;
      const hasDeclaredName = declaredNameCol !== -1;
      
      if (!hasRequirementClass || !hasDataType || !hasDeclaredName) {
        const missing: string[] = [];
        if (!hasDeclaredName) missing.push('declared_name');
        if (!hasRequirementClass) missing.push('requirement_class');
        if (!hasDataType) missing.push('data_type');
        
        warnings.push({
          type: 'missing_header_rows',
          category: 'schema',
          severity: 'critical',
          message: `Missing required header rows: ${missing.join(', ')}`,
          recommendation: 'Ensure your CSV has rows for: declared_name, requirement_class, and data_type',
          examples: missing.map(m => `Missing: ${m}`),
          idealFormat: 'CSV should have header rows in this order: Object labels, nested_object_N, declared_name, requirement_class, data_type, then data rows'
        });
      }
      
      // NEW Check 10: Empty columns with headers
      for (let colIndex = 0; colIndex < headerRows[0].length; colIndex++) {
        if (colIndex === declaredNameCol) continue;
        
        const hasHeader = headerRows.some(row => row[colIndex] && row[colIndex].trim() !== '');
        const hasData = dataRows.some(row => row[colIndex] && row[colIndex].trim() !== '');
        
        if (hasHeader && !hasData) {
          const headerValues = headerRows.map(row => row[colIndex]).filter(v => v && v.trim()).join(' > ');
          warnings.push({
            type: 'empty_column',
            category: 'data_quality',
            severity: 'info',
            message: `Column ${colIndex + 1} has headers but no data`,
            recommendation: 'Either add data to this column or remove the column entirely',
            column: colIndex + 1,
            examples: [`Headers: ${headerValues}`],
            idealFormat: 'Columns with headers should contain at least some data values'
          });
        }
      }
      
      // NEW Check 11: Requirement class consistency
      if (requirementClassRow !== -1) {
        const validClasses = ['mandatory', 'optional', 'conditional', 'recommended'];
        for (let colIndex = 0; colIndex < headerRows[requirementClassRow].length; colIndex++) {
          if (colIndex === declaredNameCol) continue;
          const reqClass = headerRows[requirementClassRow][colIndex];
          if (reqClass && reqClass.trim() && !validClasses.includes(reqClass.toLowerCase().trim())) {
            warnings.push({
              type: 'invalid_requirement_class',
              category: 'schema',
              severity: 'warning',
              message: `Invalid requirement class "${reqClass}" in column ${colIndex + 1}`,
              recommendation: 'Use only: mandatory, optional, conditional, or recommended',
              column: colIndex + 1,
              examples: [`Found: "${reqClass}"`],
              idealFormat: 'Valid values: "mandatory", "optional", "conditional", "recommended"'
            });
          }
        }
      }
      
      // NEW Check 12: Nested object numbering gaps
      const nestedObjectPattern = /nested_object_(\d+)/i;
      const nestedObjectNumbers = new Set<number>();
      
      headerRows.forEach(row => {
        row.forEach(cell => {
          if (cell) {
            const match = cell.match(nestedObjectPattern);
            if (match) {
              nestedObjectNumbers.add(parseInt(match[1]));
            }
          }
        });
      });
      
      if (nestedObjectNumbers.size > 0) {
        const numbers = Array.from(nestedObjectNumbers).sort((a, b) => a - b);
        for (let i = 1; i < numbers[numbers.length - 1]; i++) {
          if (!numbers.includes(i)) {
            warnings.push({
              type: 'nested_object_gap',
              category: 'structure',
              severity: 'warning',
              message: `Gap in nested_object numbering: missing nested_object_${i}`,
              recommendation: 'Nested objects should be numbered consecutively: nested_object_1, nested_object_2, etc.',
              examples: [`Found: ${numbers.map(n => `nested_object_${n}`).join(', ')}`],
              idealFormat: 'Use consecutive numbering: nested_object_1, nested_object_2, nested_object_3...'
            });
          }
        }
      }
      
      // NEW Check 13: Data type validation
      if (dataTypeRow !== -1) {
        const validTypes = ['real', 'int', 'string', 'integer'];
        for (let colIndex = 0; colIndex < headerRows[dataTypeRow].length; colIndex++) {
          if (colIndex === declaredNameCol) continue;
          const dataType = headerRows[dataTypeRow][colIndex];
          if (dataType && dataType.trim() && !validTypes.includes(dataType.toLowerCase().trim())) {
            warnings.push({
              type: 'invalid_data_type',
              category: 'schema',
              severity: 'warning',
              message: `Invalid data type "${dataType}" in column ${colIndex + 1}`,
              recommendation: 'Use only: real (for decimals), int/integer (for whole numbers), or string',
              column: colIndex + 1,
              examples: [`Found: "${dataType}"`],
              idealFormat: 'Valid data types: "real", "int", "string"'
            });
          }
        }
      }
      
      // NEW Check 14: Column alignment - detect potential misalignment
      const columnCounts = dataRows.map(row => row.filter(cell => cell && cell.trim()).length);
      const maxCols = Math.max(...columnCounts);
      const minCols = Math.min(...columnCounts);
      
      if (maxCols - minCols > 3) {
        warnings.push({
          type: 'column_alignment',
          category: 'structure',
          severity: 'info',
          message: `Inconsistent column counts: ${minCols} to ${maxCols} filled columns per row`,
          recommendation: 'Check for potential column misalignment or shifted data',
          examples: [`Some rows have ${minCols} columns, others have ${maxCols}`],
          idealFormat: 'All data rows should have similar numbers of filled columns'
        });
      }

      // Create the JSON array
      const jsonArray: any[] = [];
      const nestedFields: string[] = [];
      const dataTypes = new Set<string>();

      // Process each data row
      for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex++) {
        const dataRow = dataRows[rowIndex];
        
        // Get the declared_name for this data row
        const declaredNameValue = dataRow[declaredNameCol];
        if (!declaredNameValue || declaredNameValue.trim() === '') continue;

        // Create a new record for this row
        const record: any = {
          declared_name: declaredNameValue
        };

        // Process each column (skip declared_name column)
        for (let colIndex = 0; colIndex < dataRow.length; colIndex++) {
          if (colIndex === declaredNameCol) continue; // Skip declared_name column
          
          const value = dataRow[colIndex];
          
          // Skip empty values
          if (!value || value.trim() === '') continue;

          // Build the nesting path from header rows (excluding requirement class and data type rows)
          const nestingPath: string[] = [];
          let propertyName = '';
          let dataType = 'string'; // default
          
          // Get data type for this column if available
          if (dataTypeRow !== -1 && dataTypeRow < headerRows.length) {
            const typeValue = headerRows[dataTypeRow][colIndex];
            if (typeValue && typeValue.trim()) {
              dataType = typeValue.trim().toLowerCase();
              dataTypes.add(dataType);
            }
          }
          
          // Build nesting path from structure header rows
          for (let headerRowIndex = 0; headerRowIndex < headerRows.length; headerRowIndex++) {
            // Skip requirement class and data type rows
            if (headerRowIndex === requirementClassRow || headerRowIndex === dataTypeRow) {
              continue;
            }
            
            const headerValue = headerRows[headerRowIndex][colIndex];
            if (!headerValue || headerValue.trim() === '') continue;
            
            const trimmedValue = headerValue.trim();
            
            // Skip nested_object_n labels - they don't define structure, just indicate nesting level
            if (trimmedValue.match(/nested_object_\d+/i)) {
              continue;
            }
            
            // Add non-empty values to the nesting path
            nestingPath.push(trimmedValue);
          }

          // The last value in the nesting path is the property name
          if (nestingPath.length === 0) continue;
          propertyName = nestingPath.pop()!;

          // Track nested fields for reporting
          if (nestingPath.length > 0) {
            const nestedFieldPath = nestingPath.join(' > ');
            if (!nestedFields.includes(nestedFieldPath)) {
              nestedFields.push(nestedFieldPath);
            }
          }

          // Convert the value using the detected data type
          const convertedValue = convertValue(value, dataType, '');

          // Navigate through the nesting path within the record
          let current = record;
          
          // Handle direct properties (no nesting)
          if (nestingPath.length === 0) {
            current[propertyName] = convertedValue;
          } else {
            // Navigate through nested structure
            for (let j = 0; j < nestingPath.length; j++) {
              const pathPart = nestingPath[j];
              
              if (j === nestingPath.length - 1) {
                // Last level - set the property
                if (!current[pathPart] || typeof current[pathPart] !== 'object' || Array.isArray(current[pathPart])) {
                  current[pathPart] = {};
                }
                current[pathPart][propertyName] = convertedValue;
              } else {
                // Intermediate level - ensure we have an object to work with
                if (!current[pathPart] || typeof current[pathPart] !== 'object' || Array.isArray(current[pathPart])) {
                  current[pathPart] = {};
                }
                current = current[pathPart];
              }
            }
          }
        }
        
        jsonArray.push(record);
      }

      // Convert to formatted JSON string
      const jsonString = JSON.stringify(jsonArray, null, 2);
      
      setResult({
        jsonOutput: jsonString,
        fieldCount: headerRows[0] ? headerRows[0].filter(f => f && f.trim()).length - 1 : 0,
        nestedFields,
        dataTypes: Array.from(dataTypes),
        warnings
      });

    } catch (err) {
      const errorMsg = 'Error processing file: ' + (err as Error).message;
      console.error('Conversion error:', err);
      console.error('Error stack:', (err as Error).stack);
      setError(errorMsg);
      setIsProcessing(false);
    }
  };

  const copyToClipboard = async () => {
    if (!result) return;
    
    try {
      await navigator.clipboard.writeText(result.jsonOutput);
      alert('JSON output copied to clipboard!');
    } catch (err) {
      alert('Could not copy to clipboard');
    }
  };

  const downloadJson = () => {
    if (!result) return;
    
    const blob = new Blob([result.jsonOutput], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file?.name.replace('.csv', '.json') || 'converted.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadWarningsReport = () => {
    if (!result || !result.warnings.length) return;
    
    // Group warnings by category
    const groupedWarnings = {
      critical: result.warnings.filter(w => w.severity === 'critical'),
      warning: result.warnings.filter(w => w.severity === 'warning'),
      info: result.warnings.filter(w => w.severity === 'info')
    };
    
    const reportLines = [
      '# Data Quality Report',
      `Generated: ${new Date().toLocaleString()}`,
      `File: ${file?.name}`,
      `Total Issues: ${result.warnings.length}`,
      '',
      '## Summary',
      `- Critical Issues: ${groupedWarnings.critical.length}`,
      `- Warnings: ${groupedWarnings.warning.length}`,
      `- Info: ${groupedWarnings.info.length}`,
      '',
    ];
    
    // Add issues by severity
    ['critical', 'warning', 'info'].forEach(severity => {
      const warnings = groupedWarnings[severity as keyof typeof groupedWarnings];
      if (warnings.length > 0) {
        reportLines.push(`## ${severity.toUpperCase()} Issues (${warnings.length})`);
        reportLines.push('');
        
        warnings.forEach((w, idx) => {
          reportLines.push(`### ${idx + 1}. ${w.message}`);
          reportLines.push(`**Category:** ${w.category}`);
          if (w.row) reportLines.push(`**Row:** ${w.row}`);
          if (w.column) reportLines.push(`**Column:** ${w.column}`);
          reportLines.push(`**Recommendation:** ${w.recommendation}`);
          if (w.idealFormat) reportLines.push(`**Ideal Format:** ${w.idealFormat}`);
          if (w.examples && w.examples.length > 0) {
            reportLines.push(`**Examples:**`);
            w.examples.forEach(ex => reportLines.push(`  - ${ex}`));
          }
          reportLines.push('');
        });
      }
    });
    
    const reportText = reportLines.join('\n');
    const blob = new Blob([reportText], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file?.name.replace('.csv', '-quality-report.md') || 'quality-report.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const analyzeFile = async (selectedFile: File) => {
    setIsAnalyzing(true);
    setPreAnalysis(null);
    setError('');
    
    try {
      const csvData = await selectedFile.text();
      const parsed = Papa.parse(csvData, {
        skipEmptyLines: true,
        dynamicTyping: false,
        delimitersToGuess: [',', '\t', '|', ';']
      });
      
      const rows = parsed.data as string[][];
      const issues: string[] = [];
      
      // Find declared_name
      let declaredNameCol = -1;
      let dataTypeRow = -1;
      let dataStartRow = -1;
      
      for (let rowIndex = 0; rowIndex < Math.min(rows.length, 20); rowIndex++) {
        const row = rows[rowIndex];
        for (let colIndex = 0; colIndex < row.length; colIndex++) {
          if (row[colIndex] && row[colIndex].trim() === 'declared_name') {
            declaredNameCol = colIndex;
            break;
          }
        }
        const firstCell = row[0]?.toLowerCase().trim() || '';
        if (firstCell === 'data type' || firstCell === 'data_type') {
          dataTypeRow = rowIndex;
        }
      }
      
      // Find data start
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex];
        const hasHeaderPattern = row.some(cell => {
          if (!cell) return false;
          const lower = cell.toLowerCase().trim();
          return (
            lower === 'declared_name' ||
            lower === 'requirement class' ||
            lower === 'data type' ||
            lower === 'data_type' ||
            lower.startsWith('nested_object_') ||
            (lower === 'object' && row[0] === cell)
          );
        });
        
        if (!hasHeaderPattern && rowIndex > 2) {
          const hasData = row.some(cell => cell && cell.trim() !== '');
          if (hasData) {
            dataStartRow = rowIndex;
            break;
          }
        }
      }
      
      // Auto-detect if not found
      if (dataStartRow === -1 && declaredNameCol !== -1) {
        let headerLikeRows = 0;
        for (let i = 0; i < Math.min(rows.length, 15); i++) {
          const hasPattern = rows[i].some(cell => {
            if (!cell) return false;
            const lower = cell.toLowerCase().trim();
            return (
              lower === 'declared_name' ||
              lower === 'requirement class' ||
              lower === 'data type' ||
              lower === 'data_type' ||
              lower.startsWith('nested_object_') ||
              lower === 'object'
            );
          });
          if (hasPattern) headerLikeRows = i + 1;
        }
        if (headerLikeRows > 0 && headerLikeRows < rows.length) {
          dataStartRow = headerLikeRows;
        }
      }
      
      // Collect issues
      if (declaredNameCol === -1) {
        issues.push('❌ CRITICAL: No "declared_name" column found in first 20 rows');
      }
      if (dataTypeRow === -1) {
        issues.push('⚠️ WARNING: No "Data Type" row found');
      }
      if (dataStartRow === -1) {
        issues.push('❌ CRITICAL: Cannot determine where data rows begin');
      } else if (dataStartRow >= rows.length) {
        issues.push('❌ CRITICAL: Data section would start beyond end of file');
      }
      
      const estimatedDataRows = dataStartRow !== -1 ? rows.length - dataStartRow : 0;
      if (estimatedDataRows === 0) {
        issues.push('❌ CRITICAL: No data rows detected');
      }
      
      setPreAnalysis({
        issues,
        structure: {
          totalRows: rows.length,
          declaredNameFound: declaredNameCol !== -1,
          declaredNameCol,
          dataTypeRowFound: dataTypeRow !== -1,
          dataTypeRow,
          dataStartRow,
          estimatedDataRows
        }
      });
      
    } catch (err) {
      setError('Failed to analyze CSV: ' + (err as Error).message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      if (!selectedFile.name.toLowerCase().endsWith('.csv')) {
        setError('Please select a CSV file');
        setFile(null);
        setResult(null);
        setPreAnalysis(null);
        return;
      }
      setFile(selectedFile);
      setError('');
      setResult(null);
      console.log('File selected:', selectedFile.name, selectedFile.size, 'bytes');
      
      // Immediately analyze the file
      await analyzeFile(selectedFile);
    }
  };

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    const droppedFile = event.dataTransfer.files[0];
    if (droppedFile && droppedFile.name.toLowerCase().endsWith('.csv')) {
      setFile(droppedFile);
      setError('');
      setResult(null);
      console.log('File dropped:', droppedFile.name, droppedFile.size, 'bytes');
      
      // Immediately analyze the file
      await analyzeFile(droppedFile);
    } else {
      setError('Please drop a CSV file');
      setFile(null);
      setResult(null);
      setPreAnalysis(null);
    }
  };

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="text-center space-y-4">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 text-white rounded-xl shadow-lg">
          <FileText className="w-8 h-8" />
        </div>
        <div>
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            CSV to JSON Converter
          </h1>
          <p className="text-lg text-gray-600">
            Convert structured CSV files to JSON with advanced mapping rules
          </p>
        </div>
      </div>

      {/* File Upload */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <Upload className="w-5 h-5" />
          Upload CSV File
        </h2>
        <div
          className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center transition-all duration-300 hover:border-blue-400 hover:bg-gray-50 cursor-pointer"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          {file ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-green-600">{file.name}</p>
              <p className="text-xs text-gray-500">
                {(file.size / 1024).toFixed(1)} KB
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-medium">Drop your CSV file here or click to browse</p>
              <p className="text-xs text-gray-500">
                Dynamic header detection: declared_name column + any number of nested_object_n levels
              </p>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
        
        {file && (
          <div className="mt-4 flex justify-center">
            <button 
              onClick={processFile} 
              disabled={isProcessing || isAnalyzing || (preAnalysis && preAnalysis.issues.length > 0)}
              className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isAnalyzing ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Analyzing CSV...
                </span>
              ) : isProcessing ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Processing...
                </span>
              ) : preAnalysis && preAnalysis.issues.length > 0 ? (
                'Fix Issues Before Converting'
              ) : (
                'Convert to JSON'
              )}
            </button>
          </div>
        )}
      </div>

      {/* Pre-Analysis Section - Shows immediately after file upload */}
      {preAnalysis && (
        <div className={`border-2 rounded-lg p-6 shadow-lg ${
          preAnalysis.issues.length > 0 
            ? 'bg-red-50 border-red-400' 
            : 'bg-green-50 border-green-400'
        }`}>
          <div className="flex items-start gap-3 mb-4">
            <AlertCircle className={`h-6 w-6 mt-0.5 flex-shrink-0 ${
              preAnalysis.issues.length > 0 ? 'text-red-600' : 'text-green-600'
            }`} />
            <div className="flex-1">
              <h3 className="text-xl font-bold mb-2 flex items-center gap-2">
                {preAnalysis.issues.length > 0 ? (
                  <>
                    <span className="text-red-900">❌ CSV Structure Issues Detected</span>
                    <span className="text-sm font-normal text-red-700">({preAnalysis.issues.length} issues)</span>
                  </>
                ) : (
                  <span className="text-green-900">✅ CSV Structure Looks Good</span>
                )}
              </h3>
              
              {/* Structure Info */}
              <div className="bg-white/70 rounded-lg p-4 mb-4 text-sm">
                <h4 className="font-semibold mb-2 text-gray-900">📊 Detected Structure:</h4>
                <div className="space-y-1 text-gray-700">
                  <div>• Total rows: <strong>{preAnalysis.structure.totalRows}</strong></div>
                  <div>• declared_name column: {preAnalysis.structure.declaredNameFound ? 
                    <span className="text-green-700">✓ Found at column {preAnalysis.structure.declaredNameCol + 1}</span> : 
                    <span className="text-red-700">✗ Not found</span>
                  }</div>
                  <div>• Data Type row: {preAnalysis.structure.dataTypeRowFound ? 
                    <span className="text-green-700">✓ Found at row {preAnalysis.structure.dataTypeRow + 1}</span> : 
                    <span className="text-orange-600">⚠ Not found</span>
                  }</div>
                  <div>• Data rows start: {preAnalysis.structure.dataStartRow !== -1 ? 
                    <span className="text-green-700">✓ Row {preAnalysis.structure.dataStartRow + 1}</span> : 
                    <span className="text-red-700">✗ Cannot determine</span>
                  }</div>
                  <div>• Estimated data rows: <strong>{preAnalysis.structure.estimatedDataRows}</strong></div>
                </div>
              </div>
              
              {/* Issues List */}
              {preAnalysis.issues.length > 0 && (
                <div className="space-y-3">
                  <h4 className="font-semibold text-red-900">🔧 Required Fixes:</h4>
                  {preAnalysis.issues.map((issue, idx) => (
                    <div key={idx} className="bg-white rounded-lg p-3 border-l-4 border-red-500">
                      <div className="font-medium text-red-900">{issue}</div>
                    </div>
                  ))}
                  
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-4">
                    <h4 className="font-semibold text-blue-900 mb-2">💡 Expected CSV Structure:</h4>
                    <div className="text-sm text-blue-800 space-y-1 font-mono">
                      <div>Row 1: Empty or "Object"</div>
                      <div>Row 2: "Data Type" | string | real | int | ...</div>
                      <div>Row 3: "Object" | declared_name | PropertyName1 | PropertyName2 | ...</div>
                      <div>Row 4: "Nested_object_1" | (empty) | SubProperty | SubProperty | ...</div>
                      <div>Row 5+: More nested levels or data starts</div>
                      <div className="text-blue-900 font-bold mt-2">Then: DATA ROWS with actual values</div>
                    </div>
                  </div>
                </div>
              )}
              
              {preAnalysis.issues.length === 0 && (
                <div className="text-green-800 text-sm">
                  Your CSV structure looks valid. Click "Convert to JSON" to proceed with conversion.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Error Display - Make it very prominent */}
      {error && (
        <div className="bg-red-50 border-2 border-red-400 rounded-lg p-6 shadow-lg">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-6 w-6 text-red-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="text-lg font-bold text-red-900 mb-2">Conversion Error</h3>
              <p className="text-red-800 whitespace-pre-line">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-6">
          {/* Enhanced Warnings Display */}
          {result.warnings.length > 0 && (() => {
            const groupedWarnings = {
              critical: result.warnings.filter(w => w.severity === 'critical'),
              warning: result.warnings.filter(w => w.severity === 'warning'),
              info: result.warnings.filter(w => w.severity === 'info')
            };
            
            const getSeverityColor = (severity: string) => {
              switch(severity) {
                case 'critical': return { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-900', badge: 'bg-red-600' };
                case 'warning': return { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-900', badge: 'bg-yellow-600' };
                case 'info': return { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-900', badge: 'bg-blue-600' };
                default: return { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-900', badge: 'bg-gray-600' };
              }
            };
            
            return (
              <div className="bg-gradient-to-r from-yellow-50 to-orange-50 border-2 border-yellow-300 rounded-lg p-6 shadow-lg">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <AlertCircle className="h-6 w-6 text-yellow-700" />
                    <div>
                      <h3 className="text-xl font-bold text-yellow-900">
                        Data Quality Cleanup Recommendations
                      </h3>
                      <p className="text-sm text-yellow-800 mt-1">
                        {result.warnings.length} issue{result.warnings.length !== 1 ? 's' : ''} found - Conversion succeeded, but these improvements are recommended
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setExpandedWarnings(!expandedWarnings)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-white border border-yellow-300 rounded-lg text-sm font-medium text-yellow-800 hover:bg-yellow-50"
                    >
                      {expandedWarnings ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      {expandedWarnings ? 'Collapse' : 'Expand'}
                    </button>
                    <button
                      onClick={downloadWarningsReport}
                      className="flex items-center gap-2 px-3 py-1.5 bg-yellow-600 text-white rounded-lg text-sm font-medium hover:bg-yellow-700"
                    >
                      <Download className="w-4 h-4" />
                      Export Report
                    </button>
                  </div>
                </div>
                
                {/* Summary Badges */}
                <div className="flex gap-3 mb-4">
                  {groupedWarnings.critical.length > 0 && (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-red-100 border border-red-300 rounded-lg">
                      <span className="w-2 h-2 bg-red-600 rounded-full"></span>
                      <span className="text-sm font-semibold text-red-900">
                        {groupedWarnings.critical.length} Critical
                      </span>
                    </div>
                  )}
                  {groupedWarnings.warning.length > 0 && (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-100 border border-yellow-300 rounded-lg">
                      <span className="w-2 h-2 bg-yellow-600 rounded-full"></span>
                      <span className="text-sm font-semibold text-yellow-900">
                        {groupedWarnings.warning.length} Warning{groupedWarnings.warning.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  )}
                  {groupedWarnings.info.length > 0 && (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-100 border border-blue-300 rounded-lg">
                      <span className="w-2 h-2 bg-blue-600 rounded-full"></span>
                      <span className="text-sm font-semibold text-blue-900">
                        {groupedWarnings.info.length} Info
                      </span>
                    </div>
                  )}
                </div>
                
                {expandedWarnings && (
                  <div className="space-y-4">
                    {/* Group by Category */}
                    {[
                      { key: 'schema', title: '📋 Schema Structure Issues', warnings: result.warnings.filter(w => w.category === 'schema') },
                      { key: 'data_quality', title: '🔍 Data Quality Issues', warnings: result.warnings.filter(w => w.category === 'data_quality') },
                      { key: 'naming', title: '🏷️ Naming Convention Issues', warnings: result.warnings.filter(w => w.category === 'naming') },
                      { key: 'structure', title: '🔧 Structural Issues', warnings: result.warnings.filter(w => w.category === 'structure') }
                    ].filter(group => group.warnings.length > 0).map(group => (
                      <div key={group.key} className="space-y-2">
                        <h4 className="font-bold text-gray-900 text-sm uppercase tracking-wide">{group.title}</h4>
                        {group.warnings.map((warning, idx) => {
                          const colors = getSeverityColor(warning.severity);
                          return (
                            <div key={idx} className={`${colors.bg} border ${colors.border} rounded-lg p-4`}>
                              <div className="flex items-start gap-3">
                                <span className={`${colors.badge} text-white text-xs font-bold px-2 py-1 rounded uppercase mt-0.5`}>
                                  {warning.severity}
                                </span>
                                <div className="flex-1 space-y-2">
                                  <div className={`font-semibold ${colors.text}`}>{warning.message}</div>
                                  
                                  {/* Location Info */}
                                  {(warning.row || warning.column) && (
                                    <div className="text-xs text-gray-600 flex gap-3">
                                      {warning.row && <span>📍 Row: {warning.row}</span>}
                                      {warning.column && <span>📍 Column: {warning.column}</span>}
                                    </div>
                                  )}
                                  
                                  {/* Recommendation */}
                                  <div className="bg-white/70 rounded p-2 border border-gray-200">
                                    <div className="text-xs font-semibold text-gray-700 mb-1">💡 Recommendation:</div>
                                    <div className="text-sm text-gray-800">{warning.recommendation}</div>
                                  </div>
                                  
                                  {/* Examples from Data */}
                                  {warning.examples && warning.examples.length > 0 && (
                                    <div className="bg-white/70 rounded p-2 border border-gray-200">
                                      <div className="text-xs font-semibold text-gray-700 mb-1">📌 Examples from your data:</div>
                                      <div className="text-xs font-mono space-y-1">
                                        {warning.examples.map((example, exIdx) => (
                                          <div key={exIdx} className="text-gray-700">{example}</div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  
                                  {/* Ideal Format */}
                                  {warning.idealFormat && (
                                    <div className="bg-green-50 rounded p-2 border border-green-200">
                                      <div className="text-xs font-semibold text-green-800 mb-1">✅ Ideal Format:</div>
                                      <div className="text-xs font-mono text-green-900">{warning.idealFormat}</div>
                                    </div>
                                  )}
                                  
                                  {/* Additional Details */}
                                  {warning.details && warning.details.length > 0 && !warning.examples && (
                                    <div className="text-xs text-gray-600">
                                      <span className="font-semibold">Values: </span>
                                      {warning.details.slice(0, 5).join(', ')}
                                      {warning.details.length > 5 && ` (+${warning.details.length - 5} more)`}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
          
          {/* Summary Stats */}
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-600" />
              Conversion Summary
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center p-4 bg-gray-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">{result.fieldCount}</div>
                <div className="text-sm text-gray-600">Total Fields</div>
              </div>
              <div className="text-center p-4 bg-gray-50 rounded-lg">
                <div className="text-2xl font-bold text-green-600">{result.nestedFields.length}</div>
                <div className="text-sm text-gray-600">Nested Fields</div>
              </div>
              <div className="text-center p-4 bg-gray-50 rounded-lg">
                <div className="text-2xl font-bold text-yellow-600">{result.dataTypes.length}</div>
                <div className="text-sm text-gray-600">Data Types</div>
              </div>
            </div>
            
            {result.dataTypes.length > 0 && (
              <div className="mt-4">
                <p className="text-sm font-medium mb-2">Data Types Found:</p>
                <div className="flex flex-wrap gap-2">
                  {result.dataTypes.map((type, index) => (
                    <span key={index} className="px-2 py-1 bg-blue-100 text-blue-800 text-sm rounded">{type}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* JSON Output */}
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Generated JSON</h2>
              <div className="flex gap-2">
                <button
                  onClick={copyToClipboard}
                  className="flex items-center gap-2 px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50"
                >
                  <Copy className="w-4 h-4" />
                  Copy
                </button>
                <button
                  onClick={downloadJson}
                  className="flex items-center gap-2 px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50"
                >
                  <Download className="w-4 h-4" />
                  Download
                </button>
              </div>
            </div>
            <div className="bg-gray-900 border border-gray-300 rounded-lg p-4 max-h-96 overflow-auto">
              <pre className="text-sm text-gray-100 whitespace-pre-wrap font-mono">
                {result.jsonOutput}
              </pre>
            </div>
          </div>

          {/* Conversion Rules */}
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
            <h2 className="text-xl font-semibold mb-4">Conversion Rules Applied</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="space-y-2">
                <div className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600 mt-0.5" />
                  <span>Dynamic nesting with Object and nested_object_N columns</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600 mt-0.5" />
                  <span>Array values in brackets [like this] parsed as JSON arrays</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600 mt-0.5" />
                  <span>Numeric values auto-converted based on data types</span>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600 mt-0.5" />
                  <span>Fields with units nested as {`{value, unit}`} objects</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600 mt-0.5" />
                  <span>Empty values converted to null</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600 mt-0.5" />
                  <span>Data types: real, int, string automatically detected</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CsvConverter;