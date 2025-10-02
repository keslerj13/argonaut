import React, { useState, useRef } from 'react';
import Papa from 'papaparse';
import { Upload, Download, FileText, CheckCircle, AlertCircle, Copy } from 'lucide-react';

interface ValidationWarning {
  type: string;
  message: string;
  row?: number;
  column?: number;
  details?: string[];
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
            warnings.push({
              type: 'missing_data_type',
              message: 'Column missing data type',
              column: colIndex + 1
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
        warnings.push({
          type: 'duplicate_declared_names',
          message: 'Duplicate declared_name values found',
          details: [...new Set(duplicates)]
        });
      }
      
      // Check 3: declared_name with spaces or invalid characters
      declaredNames.forEach((name, index) => {
        if (/[^\w\-]/.test(name)) {
          warnings.push({
            type: 'invalid_declared_name',
            message: `Invalid declared_name "${name}" contains spaces or unicode characters`,
            row: dataStartRow + index + 1
          });
        }
      });
      
      // Check 4: Data with embedded units (like "15 mm")
      for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex++) {
        const dataRow = dataRows[rowIndex];
        for (let colIndex = 0; colIndex < dataRow.length; colIndex++) {
          if (colIndex === declaredNameCol) continue;
          const value = dataRow[colIndex];
          if (value && /^\d+\.?\d*\s+(mm|m|cm|km|kg|g|kW|MW|kWh|°C|°F|Hz|kHz|MHz)/.test(value.trim())) {
            warnings.push({
              type: 'embedded_unit',
              message: `Value "${value}" contains embedded unit`,
              row: dataStartRow + rowIndex + 1,
              column: colIndex + 1
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
            message: 'Column has nested object label but no top-level object key',
            column: colIndex + 1
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
              message: 'Column has inconsistent units',
              column: colIndex + 1,
              details: uniqueUnits
            });
          }
        }
      }
      
      // Check 7: Filled cells in first column under nested_objects list
      for (let headerRowIndex = 0; headerRowIndex < headerRows.length; headerRowIndex++) {
        const firstColValue = headerRows[headerRowIndex][0];
        // Skip rows that are supposed to have values (declared_name, requirement class, data type rows)
        const isExpectedRow = firstColValue && (
          firstColValue.toLowerCase().includes('declared_name') ||
          firstColValue.toLowerCase().includes('requirement') ||
          firstColValue.toLowerCase().includes('data') && firstColValue.toLowerCase().includes('type')
        );
        
        if (!isExpectedRow && firstColValue && firstColValue.trim() !== '') {
          warnings.push({
            type: 'invalid_first_column',
            message: `First column should be empty in nested object structure rows, found "${firstColValue}"`,
            row: headerRowIndex + 1
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
      valueUnitPairs.forEach((pair, pathKey) => {
        if (pair.valueCol !== -1 && pair.unitCol !== -1) {
          for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex++) {
            const valueCell = dataRows[rowIndex][pair.valueCol];
            const unitCell = dataRows[rowIndex][pair.unitCol];
            
            const hasValue = valueCell && valueCell.trim() !== '';
            const hasUnit = unitCell && unitCell.trim() !== '';
            
            if (hasValue !== hasUnit) {
              warnings.push({
                type: 'value_unit_mismatch',
                message: `Value/unit mismatch for "${pathKey.replace(/\|/g, ' > ')}"`,
                row: dataStartRow + rowIndex + 1,
                details: [`Value: ${hasValue ? 'filled' : 'empty'}, Unit: ${hasUnit ? 'filled' : 'empty'}`]
              });
            }
          }
        }
      });

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
      setError('Error processing file: ' + (err as Error).message);
    } finally {
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

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      if (!selectedFile.name.toLowerCase().endsWith('.csv')) {
        setError('Please select a CSV file');
        return;
      }
      setFile(selectedFile);
      setError('');
      setResult(null);
    }
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const droppedFile = event.dataTransfer.files[0];
    if (droppedFile && droppedFile.name.toLowerCase().endsWith('.csv')) {
      setFile(droppedFile);
      setError('');
      setResult(null);
    } else {
      setError('Please drop a CSV file');
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
              disabled={isProcessing}
              className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg font-medium disabled:opacity-50"
            >
              {isProcessing ? 'Processing...' : 'Convert to JSON'}
            </button>
          </div>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <p className="text-red-800">{error}</p>
          </div>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-6">
          {/* Warnings */}
          {result.warnings.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-start gap-2 mb-3">
                <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-semibold text-yellow-900 mb-2">
                    Quality Warnings ({result.warnings.length})
                  </h3>
                  <p className="text-sm text-yellow-800 mb-3">
                    The following issues were detected. The conversion completed, but you may want to review these:
                  </p>
                  <div className="space-y-2">
                    {result.warnings.map((warning, idx) => (
                      <div key={idx} className="bg-white rounded p-3 text-sm">
                        <div className="font-medium text-yellow-900">{warning.message}</div>
                        {warning.row && (
                          <div className="text-yellow-700 mt-1">Row: {warning.row}</div>
                        )}
                        {warning.column && (
                          <div className="text-yellow-700 mt-1">Column: {warning.column}</div>
                        )}
                        {warning.details && warning.details.length > 0 && (
                          <div className="text-yellow-700 mt-1">
                            Values: {warning.details.join(', ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
          
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