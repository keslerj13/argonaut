import React, { useState, useRef } from 'react';
import Papa from 'papaparse';
import JSZip from 'jszip';
import { Upload, Download, FileText, CheckCircle, AlertCircle, Copy, ChevronDown, ChevronUp } from 'lucide-react';
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";

interface ConversionResult {
  jsonOutput: string;
  fieldCount: number;
  nestedFields: string[];
  dataTypes: string[];
}

const Index = () => {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [error, setError] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [mode, setMode] = useState<'csv-to-json' | 'json-to-csv'>('csv-to-json');
  const [jsonInput, setJsonInput] = useState<string>('');
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const analyzeFile = async (selectedFile: File) => {
    console.log('🔍 Starting file analysis...');
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
      
      console.log(`📊 CSV has ${rows.length} total rows`);
      
      // Find declared_name
      let declaredNameCol = -1;
      let dataTypeRow = -1;
      let dataStartRow = -1;
      
      for (let rowIndex = 0; rowIndex < Math.min(rows.length, 20); rowIndex++) {
        const row = rows[rowIndex];
        for (let colIndex = 0; colIndex < row.length; colIndex++) {
          if (row[colIndex] && row[colIndex].trim() === 'declared_name') {
            declaredNameCol = colIndex;
            console.log(`✓ Found declared_name at column ${colIndex}`);
            break;
          }
        }
        const firstCell = row[0]?.toLowerCase().trim() || '';
        if (firstCell === 'data type' || firstCell === 'data_type') {
          dataTypeRow = rowIndex;
          console.log(`✓ Found data type row at ${rowIndex}`);
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
            console.log(`✓ Data starts at row ${rowIndex}`);
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
          console.log(`✓ Auto-detected data start at row ${dataStartRow}`);
        }
      }
      
      // NEW: Check for missing data types in specific columns
      if (dataTypeRow !== -1) {
        const missingDataTypeCols: number[] = [];
        const dataTypeRowData = rows[dataTypeRow];
        
        for (let colIndex = 1; colIndex < dataTypeRowData.length; colIndex++) {
          const dataType = dataTypeRowData[colIndex];
          if (!dataType || dataType.trim() === '') {
            missingDataTypeCols.push(colIndex);
          }
        }
        
        if (missingDataTypeCols.length > 0) {
          issues.push(`❌ CRITICAL: Missing data types in ${missingDataTypeCols.length} column(s): ${missingDataTypeCols.slice(0, 5).map(c => `Col ${c + 1}`).join(', ')}${missingDataTypeCols.length > 5 ? ` and ${missingDataTypeCols.length - 5} more` : ''}`);
          console.error(`❌ Missing data types in columns:`, missingDataTypeCols);
        }
      }
      
      // NEW: Check for gaps in nested_object numbering AND blank rows between them
      const nestedObjectRows: { row: number; num: number }[] = [];
      for (let rowIndex = 0; rowIndex < Math.min(rows.length, 20); rowIndex++) {
        const firstCell = rows[rowIndex][0];
        if (firstCell) {
          const match = firstCell.match(/^nested_object_(\d+)$/i);
          if (match) {
            nestedObjectRows.push({ row: rowIndex, num: parseInt(match[1]) });
          }
        }
      }
      
      if (nestedObjectRows.length > 0) {
        nestedObjectRows.sort((a, b) => a.row - b.row); // Sort by row position
        
        // Check for blank rows BETWEEN nested_object rows in column 1
        for (let i = 0; i < nestedObjectRows.length - 1; i++) {
          const currentRow = nestedObjectRows[i].row;
          const nextRow = nestedObjectRows[i + 1].row;
          
          if (nextRow - currentRow > 1) {
            // There's a gap - check if there are blank rows
            const gapSize = nextRow - currentRow - 1;
            issues.push(`❌ CRITICAL: Gap of ${gapSize} blank row(s) between nested_object_${nestedObjectRows[i].num} (row ${currentRow + 1}) and nested_object_${nestedObjectRows[i + 1].num} (row ${nextRow + 1}). All nested_object rows must be consecutive!`);
            console.error(`❌ Blank rows between nested_object_${nestedObjectRows[i].num} and nested_object_${nestedObjectRows[i + 1].num}`);
          }
        }
        
        // NEW: Check each column for empty cells within nested_object rows
        const firstRowLength = rows[0]?.length || 0;
        for (let colIndex = 2; colIndex < firstRowLength; colIndex++) {
          const colValues: { row: number; value: string; nestedNum: number }[] = [];
          
          // Collect all values in this column for nested_object rows
          for (const nestedRow of nestedObjectRows) {
            const cellValue = rows[nestedRow.row][colIndex];
            colValues.push({
              row: nestedRow.row,
              value: cellValue?.trim() || '',
              nestedNum: nestedRow.num
            });
          }
          
          // Find first and last non-empty values
          const firstNonEmpty = colValues.findIndex(v => v.value !== '');
          const lastNonEmpty = colValues.length - 1 - colValues.slice().reverse().findIndex(v => v.value !== '');
          
          // If column has values, check for gaps between first and last
          if (firstNonEmpty !== -1 && lastNonEmpty !== -1 && firstNonEmpty < lastNonEmpty) {
            const emptyBetween: number[] = [];
            for (let i = firstNonEmpty + 1; i < lastNonEmpty; i++) {
              if (colValues[i].value === '') {
                emptyBetween.push(colValues[i].nestedNum);
              }
            }
            
            if (emptyBetween.length > 0) {
              // Get object key from row 1 (object row), fallback to data type from row 0
              const objectKey = rows[1]?.[colIndex]?.trim() || rows[0]?.[colIndex]?.trim() || `Col ${colIndex + 1}`;
              issues.push(`❌ CRITICAL: Column "${objectKey}" has empty cells in nested_object_${emptyBetween.join(', nested_object_')} rows. All nested_object values within a column must be consecutive!`);
              console.error(`❌ Column ${colIndex} (${objectKey}) has gaps in nested_object values`);
            }
          }
        }
        
        // Check for missing numbers in sequence
        const numbers = nestedObjectRows.map(n => n.num);
        numbers.sort((a, b) => a - b);
        const minNum = Math.min(...numbers);
        const maxNum = Math.max(...numbers);
        
        const missingNumbers: number[] = [];
        for (let i = minNum; i <= maxNum; i++) {
          if (!numbers.includes(i)) {
            missingNumbers.push(i);
          }
        }
        
        if (missingNumbers.length > 0) {
          issues.push(`⚠️ WARNING: Gap in nested_object numbering - missing: nested_object_${missingNumbers.join(', nested_object_')}`);
          console.warn(`⚠️ Missing nested_object numbers:`, missingNumbers);
        }
        
        // Check if nested_object numbering doesn't start at 1
        if (minNum !== 1) {
          issues.push(`⚠️ WARNING: nested_object numbering should start at 1, but starts at ${minNum}`);
          console.warn(`⚠️ nested_object numbering starts at ${minNum}, not 1`);
        }
        
        console.log(`Found nested_object rows:`, nestedObjectRows.map(n => `nested_object_${n.num} at row ${n.row + 1}`).join(', '));
      }
      
      // NEW: Check for #REF! and #N/A values in all cells
      const refErrors: { col: string; row: number }[] = [];
      const naErrors: { col: string; row: number }[] = [];
      
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex];
        for (let colIndex = 0; colIndex < row.length; colIndex++) {
          const cellValue = row[colIndex]?.trim() || '';
          
          if (cellValue === '#REF!' || cellValue.includes('#REF!')) {
            // Get column header from Object row (row 1) or fallback
            const colHeader = rows[1]?.[colIndex]?.trim() || `Col ${colIndex + 1}`;
            refErrors.push({ col: colHeader, row: rowIndex + 1 });
          }
          
          if (cellValue === '#N/A' || cellValue.includes('#N/A')) {
            const colHeader = rows[1]?.[colIndex]?.trim() || `Col ${colIndex + 1}`;
            naErrors.push({ col: colHeader, row: rowIndex + 1 });
          }
        }
      }
      
      if (refErrors.length > 0) {
        const firstFew = refErrors.slice(0, 5);
        const locations = firstFew.map(e => `"${e.col}" at row ${e.row}`).join(', ');
        issues.push(`❌ CRITICAL: Found ${refErrors.length} #REF! value(s) - ${locations}${refErrors.length > 5 ? ` and ${refErrors.length - 5} more` : ''}`);
        console.error(`❌ Found #REF! values:`, refErrors);
      }
      
      if (naErrors.length > 0) {
        const firstFew = naErrors.slice(0, 5);
        const locations = firstFew.map(e => `"${e.col}" at row ${e.row}`).join(', ');
        issues.push(`❌ CRITICAL: Found ${naErrors.length} #N/A value(s) - ${locations}${naErrors.length > 5 ? ` and ${naErrors.length - 5} more` : ''}`);
        console.error(`❌ Found #N/A values:`, naErrors);
      }
      
      // Collect basic issues
      if (declaredNameCol === -1) {
        issues.push('❌ CRITICAL: No "declared_name" column found in first 20 rows');
        console.error('❌ declared_name not found');
      }
      if (dataTypeRow === -1) {
        issues.push('⚠️ WARNING: No "Data Type" row found');
        console.warn('⚠️ Data Type row not found');
      }
      if (dataStartRow === -1) {
        issues.push('❌ CRITICAL: Cannot determine where data rows begin');
        console.error('❌ Cannot find data start');
      } else if (dataStartRow >= rows.length) {
        issues.push('❌ CRITICAL: Data section would start beyond end of file');
        console.error('❌ Data start beyond file end');
      }
      
      const estimatedDataRows = dataStartRow !== -1 ? rows.length - dataStartRow : 0;
      if (estimatedDataRows === 0) {
        issues.push('❌ CRITICAL: No data rows detected');
        console.error('❌ No data rows');
      }
      
      console.log(`📋 Analysis complete: ${issues.length} issues found`);
      
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
      console.error('❌ Analysis failed:', err);
      setError('Failed to analyze CSV: ' + (err as Error).message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const renderHighlightedJSON = (json: string) => {
    if (!json) return null;
    
    const lines = json.split('\n');
    return lines.map((line, lineIndex) => {
      const parts: JSX.Element[] = [];
      let remaining = line;
      let partIndex = 0;
      
      // Simple tokenization for JSON
      const tokenRegex = /"([^"\\]|\\.)*"|[{}[\],:]|\b(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b|\b(true|false|null)\b/g;
      let match;
      let lastIndex = 0;
      
      while ((match = tokenRegex.exec(line)) !== null) {
        // Add text before match
        if (match.index > lastIndex) {
          parts.push(
            <span key={`${lineIndex}-${partIndex++}`} style={{ color: '#f9fafb' }}>
              {line.slice(lastIndex, match.index)}
            </span>
          );
        }
        
        const token = match[0];
        let color = '#f9fafb';
        let fontWeight = 'normal';
        
        if (token.startsWith('"')) {
          // Check if it's a property name (followed by colon)
          const afterToken = line.slice(match.index + token.length).trim();
          if (afterToken.startsWith(':')) {
            color = '#fbbf24'; // Bright yellow/orange for property names
            fontWeight = '600';
          } else {
            color = '#34d399'; // Bright green for string values
            fontWeight = '500';
          }
        } else if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(token)) {
          color = '#60a5fa'; // Bright blue for numbers
          fontWeight = '500';
        } else if (token === 'true' || token === 'false') {
          color = '#a78bfa'; // Bright purple for booleans
          fontWeight = '500';
        } else if (token === 'null') {
          color = '#9ca3af'; // Light gray for null
          fontWeight = '500';
        } else if (/[{}[\]]/.test(token)) {
          color = '#f87171'; // Bright red for brackets/braces
          fontWeight = 'bold';
        } else if (/[,:]/.test(token)) {
          color = '#e5e7eb'; // Light gray for punctuation
          fontWeight = '500';
        }
        
        parts.push(
          <span key={`${lineIndex}-${partIndex++}`} style={{ color, fontWeight }}>
            {token}
          </span>
        );
        
        lastIndex = match.index + token.length;
      }
      
      // Add remaining text
      if (lastIndex < line.length) {
        parts.push(
          <span key={`${lineIndex}-${partIndex++}`} style={{ color: '#f9fafb' }}>
            {line.slice(lastIndex)}
          </span>
        );
      }
      
      return (
        <div key={lineIndex} style={{ lineHeight: '21px', minHeight: '21px' }}>
          {parts.length > 0 ? parts : <span style={{ color: '#f9fafb' }}>{line || '\u00A0'}</span>}
        </div>
      );
    });
  };

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

  const processJsonToCSV = () => {
    console.log('Starting JSON to CSV conversion...');
    
    if (!jsonInput.trim()) {
      setError('Please enter JSON data first');
      return;
    }

    setIsProcessing(true);
    setError('');
    setResult(null);

    try {
      // Better JSON validation with helpful error messages
      let jsonData;
      try {
        jsonData = JSON.parse(jsonInput);
      } catch (parseError) {
        if (parseError instanceof SyntaxError) {
          const match = parseError.message.match(/position (\d+)/);
          if (match) {
            const position = parseInt(match[1]);
            const lines = jsonInput.substring(0, position).split('\n');
            const lineNumber = lines.length;
            const columnNumber = lines[lines.length - 1].length + 1;
            const problemLine = jsonInput.split('\n')[lineNumber - 1] || '';
            
            throw new Error(
              `JSON syntax error at line ${lineNumber}, column ${columnNumber}:\n` +
              `"${problemLine.trim()}"\n` +
              `Error: ${parseError.message}\n\n` +
              `Common fixes:\n` +
              `• Check for missing commas between properties\n` +
              `• Ensure all strings are properly quoted\n` +
              `• Verify all brackets and braces are closed\n` +
              `• Remove trailing commas`
            );
          }
        }
        throw new Error(`Invalid JSON: ${parseError.message}`);
      }
      
      console.log('Parsed JSON data:', jsonData);
      
      // Handle both array and object inputs
      let dataArray: any[] = [];
      
      if (Array.isArray(jsonData)) {
        dataArray = jsonData;
        console.log('Input is an array with', dataArray.length, 'items');
      } else if (typeof jsonData === 'object' && jsonData !== null) {
        // Convert object to array of objects with declaredName
        dataArray = Object.entries(jsonData).map(([key, value]) => ({
          declaredName: key,
          ...(typeof value === 'object' ? value : { value })
        }));
        console.log('Converted object to array with', dataArray.length, 'items');
      } else {
        throw new Error('JSON must be an array of objects or an object');
      }
      
      if (dataArray.length === 0) {
        throw new Error('No data found to convert');
      }
      
      // Get all unique field names across all objects
      const allFields = new Set<string>();
      const dataTypes = new Set<string>();
      const nestedFields: string[] = [];
      
      const extractFields = (obj: any, prefix = '') => {
        if (!obj || typeof obj !== 'object') return;
        
        Object.keys(obj).forEach(key => {
          const fullKey = prefix ? `${prefix}.${key}` : key;
          if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key]) && !obj[key].hasOwnProperty('value')) {
            extractFields(obj[key], fullKey);
            if (prefix) nestedFields.push(fullKey);
          } else {
            allFields.add(fullKey);
          }
        });
      };

      dataArray.forEach((obj, index) => {
        console.log(`Extracting fields from object ${index}:`, obj);
        extractFields(obj);
      });
      
      const fieldsArray = Array.from(allFields);
      console.log('Extracted fields:', fieldsArray);
      
      if (fieldsArray.length === 0) {
        throw new Error('No fields found in the data');
      }
      
      // Create CSV rows
      const headerRows: string[][] = [[], [], [], []];
      
      fieldsArray.forEach((field) => {
        // Determine data type and unit
        let dataType = 'string';
        let unit = '';
        
        // Sample first non-null value to determine type
        let sampleValue = null;
        for (const obj of dataArray) {
          const value = getNestedValue(obj, field);
          if (value !== null && value !== undefined) {
            sampleValue = value;
            break;
          }
        }
        
        if (sampleValue && typeof sampleValue === 'object' && sampleValue.hasOwnProperty('value') && sampleValue.hasOwnProperty('unit')) {
          unit = sampleValue.unit;
          if (typeof sampleValue.value === 'number') {
            dataType = Number.isInteger(sampleValue.value) ? 'int' : 'real';
          }
        } else if (typeof sampleValue === 'number') {
          dataType = Number.isInteger(sampleValue) ? 'int' : 'real';
        } else if (typeof sampleValue === 'boolean') {
          dataType = 'boolean';
        } else if (Array.isArray(sampleValue)) {
          dataType = 'array';
        }
        
        dataTypes.add(dataType);
        
        // Row 1: field name + data type
        headerRows[0].push(unit ? `${field}+unit` : field);
        // Row 2: data type only
        headerRows[1].push(dataType);
        // Row 3: unit
        headerRows[2].push(unit);
        // Row 4: field name
        headerRows[3].push(field.split('.').pop() || field);
      });
      
      // Create data rows
      const dataRows: string[][] = [];
      dataArray.forEach((obj, index) => {
        console.log(`Creating CSV row for object ${index}`);
        const row: string[] = [];
        fieldsArray.forEach(field => {
          const value = getNestedValue(obj, field);
          const formatted = formatValueForCSV(value);
          row.push(formatted);
        });
        dataRows.push(row);
      });
      
      console.log('Created', dataRows.length, 'data rows');
      
      // Convert to CSV string
      const allRows = [...headerRows, ...dataRows];
      const csvString = Papa.unparse(allRows);
      
      console.log('Generated CSV string length:', csvString.length);
      
      setResult({
        jsonOutput: csvString,
        fieldCount: fieldsArray.length,
        nestedFields,
        dataTypes: Array.from(dataTypes)
      });

      console.log('Conversion completed successfully');

    } catch (err) {
      console.error('Error processing JSON:', err);
      setError('Error processing JSON: ' + (err as Error).message);
    } finally {
      setIsProcessing(false);
    }
  };

  const getNestedValue = (obj: any, path: string): any => {
    if (!obj) return null;
    
    if (path.includes('.')) {
      const parts = path.split('.');
      let current = obj;
      for (const part of parts) {
        if (current && typeof current === 'object' && part in current) {
          current = current[part];
        } else {
          return null;
        }
      }
      return current;
    }
    
    return obj[path];
  };

  const formatValueForCSV = (value: any): string => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object' && value.hasOwnProperty('value')) {
      return String(value.value);
    }
    if (Array.isArray(value)) {
      return `[${value.join(', ')}]`;
    }
    return String(value);
  };

  const processFile = async () => {
    if (mode === 'json-to-csv') {
      processJsonToCSV();
      return;
    }

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
        setError('CSV must have at least 3 rows (header rows + at least 1 data row)');
        return;
      }

      // Dynamically detect header structure
      let declaredNameCol = -1;
      let dataStartRow = -1;
      let dataTypeRow = -1;
      let requirementClassRow = -1;
      
      console.log('Detecting header structure from CSV rows:', rows.slice(0, 8));
      
      // Find declared_name column and identify important rows
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex];
        console.log(`Row ${rowIndex}:`, row.slice(0, 10));
        
        for (let colIndex = 0; colIndex < row.length; colIndex++) {
          const cell = row[colIndex];
          console.log(`  Cell [${rowIndex}][${colIndex}]: "${cell}"`);
          if (cell && cell.trim() === 'declared_name') {
            declaredNameCol = colIndex;
            console.log(`*** FOUND declared_name at row ${rowIndex}, col ${colIndex} ***`);
          }
        }
        
        // Identify special rows
        const firstCell = row[0]?.toLowerCase().trim() || '';
        if (firstCell.includes('requirement') && firstCell.includes('class')) {
          requirementClassRow = rowIndex;
          console.log('Found requirement class row:', rowIndex);
        }
        if (firstCell.includes('data') && firstCell.includes('type')) {
          dataTypeRow = rowIndex;
          console.log('Found data type row:', rowIndex);
        }
        
        // Find where data rows start (after all header rows)
        const hasHeaderPattern = row.some(cell => 
          cell && (
            cell.toLowerCase().includes('requirement') ||
            cell.toLowerCase().includes('data_type') ||
            cell.toLowerCase().includes('object') ||
            cell.toLowerCase().includes('nested_object') ||
            cell.toLowerCase().includes('declared_name')
          )
        );
        
        console.log(`Row ${rowIndex} hasHeaderPattern: ${hasHeaderPattern}`);
        
        // Only set dataStartRow if we've processed at least a few header rows
        if (!hasHeaderPattern && dataStartRow === -1 && rowIndex > 2) {
          dataStartRow = rowIndex;
          console.log('Data rows start at row:', rowIndex);
          break;
        }
      }
      
      console.log('Detection results:', { declaredNameCol, dataStartRow, dataTypeRow, requirementClassRow });
      
      if (declaredNameCol === -1) {
        console.error('Available header data:', rows.slice(0, 8));
        setError('Could not find declared_name column in CSV headers. Please ensure one of the header cells contains "declared_name".');
        return;
      }
      
      if (dataStartRow === -1) {
        // If we can't auto-detect, assume data starts after 7 header rows (based on your image)
        dataStartRow = 7;
        console.log('Could not auto-detect data start, assuming row 7');
      }
      
      // Extract header rows dynamically
      const headerRows = rows.slice(0, dataStartRow);
      const dataRows = rows.slice(dataStartRow);

      // Create the final JSON array
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
        fieldCount: headerRows[0] ? headerRows[0].filter(f => f && f.trim()).length - 1 : 0, // Subtract 1 for declared_name column
        nestedFields,
        dataTypes: Array.from(dataTypes)
      });

    } catch (err) {
      setError('Error processing file: ' + (err as Error).message);
    } finally {
      setIsProcessing(false);
    }
  };

  const copyToClipboard = async () => {
    if (!result) return;
    
    try {
      await navigator.clipboard.writeText(result.jsonOutput);
      alert(`${mode === 'csv-to-json' ? 'JSON' : 'CSV'} output copied to clipboard!`);
    } catch (err) {
      alert('Could not copy to clipboard');
    }
  };

  const downloadOutput = async () => {
    if (!result) return;
    
    // For JSON to CSV mode, use simple download
    if (mode === 'json-to-csv') {
      const blob = new Blob([result.jsonOutput], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'converted.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return;
    }
    
    // For CSV to JSON mode, create ZIP with individual files
    try {
      const jsonArray = JSON.parse(result.jsonOutput);
      
      if (!Array.isArray(jsonArray) || jsonArray.length === 0) {
        alert('No records to export');
        return;
      }
      
      const zip = new JSZip();
      
      // Get base filename from uploaded file (without extension)
      const baseFileName = file?.name.replace(/\.[^/.]+$/, '') || 'export';
      
      let skippedCount = 0;
      let exportedCount = 0;
      
      for (const record of jsonArray) {
        const guid = record._guid;
        
        // Validate GUID exists
        if (!guid || typeof guid !== 'string') {
          console.warn('Skipping record without valid _guid:', record);
          skippedCount++;
          continue;
        }
        
        // Create a copy without _id field
        const cleanedRecord = { ...record };
        delete cleanedRecord._id;
        
        // Get first two characters of GUID for subfolder
        const guidPrefix = guid.substring(0, 2).toLowerCase();
        
        // Build the path: catalog/component/<baseFileName>/<guidPrefix>/<guid>.json
        const filePath = `catalog/component/${baseFileName}/${guidPrefix}/${guid}.json`;
        
        // Pretty print the JSON with 2-space indentation
        const jsonContent = JSON.stringify(cleanedRecord, null, 2);
        
        zip.file(filePath, jsonContent);
        exportedCount++;
      }
      
      if (exportedCount === 0) {
        alert('No records with valid _guid found to export');
        return;
      }
      
      // Generate ZIP file
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      
      // Download the ZIP
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseFileName}_export.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      if (skippedCount > 0) {
        alert(`Exported ${exportedCount} files. Skipped ${skippedCount} records without valid _guid.`);
      }
      
    } catch (err) {
      console.error('Export error:', err);
      alert('Failed to create ZIP export: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    console.log('📁 File selected event triggered');
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      console.log('📁 File:', selectedFile.name, selectedFile.size, 'bytes');
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
      
      // Immediately analyze the file
      await analyzeFile(selectedFile);
    }
  };

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    console.log('📁 File dropped');
    const droppedFile = event.dataTransfer.files[0];
    if (droppedFile && droppedFile.name.toLowerCase().endsWith('.csv')) {
      console.log('📁 File:', droppedFile.name, droppedFile.size, 'bytes');
      setFile(droppedFile);
      setError('');
      setResult(null);
      
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
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        
        <div className="flex-1 flex flex-col">
          {/* Sidebar Toggle Button */}
          <div className="sticky top-0 z-10 bg-white border-b px-4 py-2">
            <SidebarTrigger />
          </div>
          
          <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', padding: '24px' }}>
            <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        
        {/* Header */}
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ 
            display: 'inline-flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            width: '64px', 
            height: '64px', 
            backgroundColor: '#3b82f6', 
            color: 'white', 
            borderRadius: '12px', 
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
            margin: '0 auto'
          }}>
            <FileText style={{ width: '32px', height: '32px' }} />
          </div>
          <div>
            <h1 style={{ fontSize: '36px', fontWeight: 'bold', color: '#1e293b', marginBottom: '8px' }}>
              {mode === 'csv-to-json' ? 'CSV to JSON Converter' : 'JSON to CSV Converter'}
            </h1>
            <p style={{ fontSize: '18px', color: '#64748b' }}>
              {mode === 'csv-to-json' 
                ? 'Convert structured CSV files to JSON with advanced mapping rules'
                : 'Convert JSON back to structured CSV format with proper headers'
              }
            </p>
          </div>
        </div>

        {/* Mode Toggle */}
        <div style={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)', padding: '24px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px' }}>Conversion Mode</h2>
          <div style={{ display: 'flex', gap: '8px', backgroundColor: '#f8fafc', padding: '4px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <button
              onClick={() => {
                setMode('csv-to-json');
                setError('');
                setResult(null);
              }}
              style={{
                flex: 1,
                padding: '8px 16px',
                borderRadius: '6px',
                border: 'none',
                fontWeight: '500',
                cursor: 'pointer',
                backgroundColor: mode === 'csv-to-json' ? '#3b82f6' : 'transparent',
                color: mode === 'csv-to-json' ? 'white' : '#64748b'
              }}
            >
              CSV → JSON
            </button>
            <button
              onClick={() => {
                setMode('json-to-csv');
                setError('');
                setResult(null);
              }}
              style={{
                flex: 1,
                padding: '8px 16px',
                borderRadius: '6px',
                border: 'none',
                fontWeight: '500',
                cursor: 'pointer',
                backgroundColor: mode === 'json-to-csv' ? '#3b82f6' : 'transparent',
                color: mode === 'json-to-csv' ? 'white' : '#64748b'
              }}
            >
              JSON → CSV
            </button>
          </div>
        </div>

        {/* Input Section */}
        <div style={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)', padding: '24px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Upload style={{ width: '20px', height: '20px' }} />
            {mode === 'csv-to-json' ? 'Upload CSV File' : 'Paste JSON Data'}
          </h2>

          {mode === 'csv-to-json' ? (
            <div>
              <div
                style={{
                  border: '2px dashed #cbd5e1',
                  borderRadius: '8px',
                  padding: '32px',
                  textAlign: 'center',
                  transition: 'all 0.3s ease',
                  cursor: 'pointer'
                }}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onClick={() => fileInputRef.current?.click()}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#3b82f6';
                  e.currentTarget.style.backgroundColor = '#f8fafc';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#cbd5e1';
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <Upload style={{ width: '48px', height: '48px', color: '#9ca3af', margin: '0 auto 16px' }} />
                {file ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <p style={{ fontSize: '14px', fontWeight: '500', color: '#059669' }}>{file.name}</p>
                    <p style={{ fontSize: '12px', color: '#6b7280' }}>
                      {(file.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <p style={{ fontSize: '14px', fontWeight: '500' }}>Drop your CSV file here or click to browse</p>
                    <p style={{ fontSize: '12px', color: '#6b7280' }}>
                      Format: 4 header rows (field+type, data type, unit, field name) + multiple data rows
                    </p>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />
              </div>
              
              {file && (
                <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'center', gap: '12px' }}>
                  <button 
                    onClick={processFile} 
                    disabled={isProcessing || isAnalyzing || (preAnalysis && preAnalysis.issues.length > 0)}
                    style={{ 
                      backgroundColor: (isProcessing || isAnalyzing || (preAnalysis && preAnalysis.issues.length > 0)) ? '#9ca3af' : '#059669', 
                      color: 'white', 
                      padding: '8px 24px', 
                      borderRadius: '8px', 
                      fontWeight: '500', 
                      border: 'none',
                      cursor: (isProcessing || isAnalyzing || (preAnalysis && preAnalysis.issues.length > 0)) ? 'not-allowed' : 'pointer',
                      opacity: (isProcessing || isAnalyzing || (preAnalysis && preAnalysis.issues.length > 0)) ? 0.6 : 1
                    }}
                  >
                    {isAnalyzing ? '🔍 Analyzing CSV...' : isProcessing ? '⏳ Processing...' : (preAnalysis && preAnalysis.issues.length > 0) ? '⛔ Fix Issues Before Converting' : 'Convert to JSON'}
                  </button>
                  {result && (
                    <button
                      onClick={downloadOutput}
                      style={{
                        backgroundColor: '#2563eb',
                        color: 'white',
                        padding: '8px 24px',
                        borderRadius: '8px',
                        fontWeight: '500',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                    >
                      <Download style={{ width: '16px', height: '16px' }} />
                      Download JSON
                    </button>
                  )}
                </div>
              )}
            </div>
           ) : (
            <div>
              {/* JSON Input with Syntax Highlighting */}
              <div style={{ position: 'relative', border: '1px solid #d1d5db', borderRadius: '8px', overflow: 'hidden', backgroundColor: '#1f2937' }}>
                <div style={{ display: 'flex', minHeight: '200px' }}>
                  {/* Line numbers */}
                  <div 
                    style={{
                      backgroundColor: '#111827',
                      borderRight: '1px solid #374151',
                      padding: '16px 8px',
                      fontSize: '14px',
                      fontFamily: 'monospace',
                      color: '#6b7280',
                      lineHeight: '1.5',
                      userSelect: 'none',
                      minWidth: '50px',
                      textAlign: 'right',
                      zIndex: 1
                    }}
                  >
                    {(jsonInput || ' ').split('\n').map((_, index) => (
                      <div key={index} style={{ height: '21px' }}>
                        {index + 1}
                      </div>
                    ))}
                  </div>
                  
                  {/* Editor area with syntax highlighting */}
                  <div style={{ position: 'relative', flex: 1, backgroundColor: '#1f2937' }}>
                    {/* Syntax highlighting background */}
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        padding: '16px',
                        fontSize: '14px',
                        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                        lineHeight: '21px',
                        whiteSpace: 'pre-wrap',
                        wordWrap: 'break-word',
                        color: '#f9fafb',
                        pointerEvents: 'none',
                        overflow: 'hidden',
                        zIndex: 1,
                        boxSizing: 'border-box'
                      }}
                    >
                      {renderHighlightedJSON(jsonInput || '')}
                    </div>
                    
                    {/* Transparent textarea overlay */}
                    <textarea
                      value={jsonInput}
                      onChange={(e) => setJsonInput(e.target.value)}
                      placeholder="Paste your JSON data here..."
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        width: '100%',
                        height: '100%',
                        minHeight: '200px',
                        padding: '16px',
                        border: 'none',
                        outline: 'none',
                        fontSize: '14px',
                        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                        lineHeight: '21px',
                        backgroundColor: 'transparent',
                        color: 'transparent',
                        caretColor: '#60a5fa',
                        resize: 'vertical',
                        zIndex: 2,
                        boxSizing: 'border-box'
                      }}
                      onScroll={(e) => {
                        const target = e.target as HTMLTextAreaElement;
                        const highlight = target.previousElementSibling as HTMLElement;
                        if (highlight) {
                          highlight.scrollTop = target.scrollTop;
                          highlight.scrollLeft = target.scrollLeft;
                        }
                      }}
                    />
                  </div>
                </div>
              </div>
              
              {jsonInput.trim() && (
                <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'center' }}>
                  <button 
                    onClick={processFile} 
                    disabled={isProcessing}
                    style={{ 
                      backgroundColor: isProcessing ? '#9ca3af' : '#059669', 
                      color: 'white', 
                      padding: '8px 24px', 
                      borderRadius: '8px', 
                      fontWeight: '500', 
                      border: 'none',
                      cursor: isProcessing ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {isProcessing ? 'Processing...' : 'Convert to CSV'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Error Display */}
        {error && (
          <div style={{ backgroundColor: '#fef2f2', border: '2px solid #ef4444', borderRadius: '8px', padding: '24px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>
            <div style={{ display: 'flex', alignItems: 'start', gap: '12px' }}>
              <AlertCircle style={{ width: '24px', height: '24px', color: '#dc2626', flexShrink: 0, marginTop: '2px' }} />
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#991b1b', marginBottom: '8px' }}>Conversion Error</h3>
                <p style={{ color: '#b91c1c', whiteSpace: 'pre-line' }}>{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Pre-Analysis Section - Shows immediately after file upload */}
        {preAnalysis && (
          <div style={{ 
            border: `2px solid ${preAnalysis.issues.length > 0 ? '#ef4444' : '#10b981'}`, 
            borderRadius: '8px', 
            padding: '24px', 
            backgroundColor: preAnalysis.issues.length > 0 ? '#fef2f2' : '#f0fdf4',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
          }}>
            <div style={{ display: 'flex', alignItems: 'start', gap: '12px', marginBottom: '16px' }}>
              <AlertCircle style={{ 
                width: '24px', 
                height: '24px', 
                color: preAnalysis.issues.length > 0 ? '#dc2626' : '#059669',
                flexShrink: 0,
                marginTop: '2px'
              }} />
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {preAnalysis.issues.length > 0 ? (
                    <>
                      <span style={{ color: '#991b1b' }}>❌ CSV Structure Issues Detected</span>
                      <span style={{ fontSize: '14px', fontWeight: 'normal', color: '#b91c1c' }}>({preAnalysis.issues.length} issues)</span>
                    </>
                  ) : (
                    <span style={{ color: '#065f46' }}>✅ CSV Structure Looks Good</span>
                  )}
                </h3>
                
                {/* Structure Info */}
                <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.7)', borderRadius: '8px', padding: '16px', marginBottom: '16px', fontSize: '14px' }}>
                  <h4 style={{ fontWeight: 600, marginBottom: '8px', color: '#111827' }}>📊 Detected Structure:</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', color: '#374151' }}>
                    <div>• Total rows: <strong>{preAnalysis.structure.totalRows}</strong></div>
                    <div>• declared_name column: {preAnalysis.structure.declaredNameFound ? 
                      <span style={{ color: '#059669' }}>✓ Found at column {preAnalysis.structure.declaredNameCol + 1}</span> : 
                      <span style={{ color: '#dc2626' }}>✗ Not found</span>
                    }</div>
                    <div>• Data Type row: {preAnalysis.structure.dataTypeRowFound ? 
                      <span style={{ color: '#059669' }}>✓ Found at row {preAnalysis.structure.dataTypeRow + 1}</span> : 
                      <span style={{ color: '#d97706' }}>⚠ Not found</span>
                    }</div>
                    <div>• Data rows start: {preAnalysis.structure.dataStartRow !== -1 ? 
                      <span style={{ color: '#059669' }}>✓ Row {preAnalysis.structure.dataStartRow + 1}</span> : 
                      <span style={{ color: '#dc2626' }}>✗ Cannot determine</span>
                    }</div>
                    <div>• Estimated data rows: <strong>{preAnalysis.structure.estimatedDataRows}</strong></div>
                  </div>
                </div>
                
                {/* Issues List */}
                {preAnalysis.issues.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <h4 style={{ fontWeight: 600, color: '#991b1b' }}>🔧 Required Fixes:</h4>
                    {preAnalysis.issues.map((issue, idx) => (
                      <div key={idx} style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '12px', borderLeft: '4px solid #ef4444' }}>
                        <div style={{ fontWeight: 500, color: '#991b1b' }}>{issue}</div>
                      </div>
                    ))}
                    
                    <div style={{ backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '16px', marginTop: '8px' }}>
                      <h4 style={{ fontWeight: 600, color: '#1e40af', marginBottom: '8px' }}>💡 Expected CSV Structure:</h4>
                      <div style={{ fontSize: '13px', color: '#1e3a8a', display: 'flex', flexDirection: 'column', gap: '4px', fontFamily: 'monospace' }}>
                        <div>Row 1: Empty or "Object"</div>
                        <div>Row 2: "Data Type" | string | real | int | ...</div>
                        <div>Row 3: "Object" | declared_name | PropertyName1 | PropertyName2 | ...</div>
                        <div>Row 4: "Nested_object_1" | (empty) | SubProperty | SubProperty | ...</div>
                        <div>Row 5+: More nested levels or data starts</div>
                        <div style={{ color: '#1e40af', fontWeight: 'bold', marginTop: '8px' }}>Then: DATA ROWS with actual values</div>
                      </div>
                    </div>
                  </div>
                )}
                
                {preAnalysis.issues.length === 0 && (
                  <div style={{ color: '#065f46', fontSize: '14px' }}>
                    Your CSV structure looks valid. Click "Convert to JSON" to proceed with conversion.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Results */}
        {result && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Summary Stats */}
            <div style={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)', padding: '24px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <CheckCircle style={{ width: '20px', height: '20px', color: '#059669' }} />
                Conversion Summary
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                <div style={{ textAlign: 'center', padding: '16px', backgroundColor: '#f8fafc', borderRadius: '8px' }}>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#3b82f6' }}>{result.fieldCount}</div>
                  <div style={{ fontSize: '14px', color: '#64748b' }}>Total Fields</div>
                </div>
                <div style={{ textAlign: 'center', padding: '16px', backgroundColor: '#f8fafc', borderRadius: '8px' }}>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#059669' }}>{result.nestedFields.length}</div>
                  <div style={{ fontSize: '14px', color: '#64748b' }}>Nested Fields</div>
                </div>
                <div style={{ textAlign: 'center', padding: '16px', backgroundColor: '#f8fafc', borderRadius: '8px' }}>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#d97706' }}>{result.dataTypes.length}</div>
                  <div style={{ fontSize: '14px', color: '#64748b' }}>Data Types</div>
                </div>
                 <div style={{ textAlign: 'center', padding: '16px', backgroundColor: '#f8fafc', borderRadius: '8px' }}>
                   <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#dc2626' }}>
                     {mode === 'csv-to-json' ? Object.keys(JSON.parse(result.jsonOutput)).length : result.jsonOutput.split('\n').length - 4}
                   </div>
                   <div style={{ fontSize: '14px', color: '#64748b' }}>Data Rows</div>
                 </div>
              </div>
              
              {result.dataTypes.length > 0 && (
                <div style={{ marginTop: '16px' }}>
                  <p style={{ fontSize: '14px', fontWeight: '500', marginBottom: '8px' }}>Data Types Found:</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {result.dataTypes.map((type, index) => (
                      <span key={index} style={{ padding: '4px 8px', backgroundColor: '#dbeafe', color: '#1e40af', fontSize: '12px', borderRadius: '4px' }}>{type}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Output */}
            <div style={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)', padding: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <h2 style={{ fontSize: '20px', fontWeight: '600' }}>
                  {mode === 'csv-to-json' ? 'Generated JSON' : 'Generated CSV'}
                </h2>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={copyToClipboard}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 12px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '14px', backgroundColor: 'white', cursor: 'pointer' }}
                  >
                    <Copy style={{ width: '16px', height: '16px' }} />
                    Copy
                  </button>
                  <button
                    onClick={downloadOutput}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 12px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '14px', backgroundColor: 'white', cursor: 'pointer' }}
                  >
                    <Download style={{ width: '16px', height: '16px' }} />
                    Download
                  </button>
                </div>
              </div>
              <div style={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px', padding: '16px', maxHeight: '400px', overflow: 'auto' }}>
                <pre style={{ fontSize: '14px', color: '#f9fafb', whiteSpace: 'pre-wrap', fontFamily: 'monospace', margin: 0 }}>
                  {result.jsonOutput}
                </pre>
              </div>
            </div>

            {/* Conversion Rules */}
            <div style={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)', padding: '24px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px' }}>Conversion Rules Applied</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px', fontSize: '14px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                    <CheckCircle style={{ width: '16px', height: '16px', color: '#059669', marginTop: '2px' }} />
                    <span>Nested fields with {">"} converted to nested objects</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                    <CheckCircle style={{ width: '16px', height: '16px', color: '#059669', marginTop: '2px' }} />
                    <span>Array values in brackets [like this] parsed as JSON arrays</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                    <CheckCircle style={{ width: '16px', height: '16px', color: '#059669', marginTop: '2px' }} />
                    <span>Numeric values auto-converted based on data types</span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                    <CheckCircle style={{ width: '16px', height: '16px', color: '#059669', marginTop: '2px' }} />
                    <span>Fields with units nested as {`{value, unit}`} objects</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                    <CheckCircle style={{ width: '16px', height: '16px', color: '#059669', marginTop: '2px' }} />
                    <span>Empty values converted to null</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                    <CheckCircle style={{ width: '16px', height: '16px', color: '#059669', marginTop: '2px' }} />
                    <span>Data types: real, int, string automatically detected</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
            </div>
          </div>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default Index;