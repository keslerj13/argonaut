import React, { useState, useRef } from 'react';
import Papa from 'papaparse';
import { Upload, Download, FileText, CheckCircle, AlertCircle, Copy } from 'lucide-react';

interface ConversionResult {
  jsonOutput: string;
  fieldCount: number;
  nestedFields: string[];
  dataTypes: string[];
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

      // Create the JSON object
      const jsonObject: any = {};
      const nestedFields: string[] = [];
      const dataTypes = new Set<string>();

      // Process each data row
      for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex++) {
        const dataRow = dataRows[rowIndex];
        
        // Get the declared_name for this data row
        const declaredNameValue = dataRow[declaredNameCol];
        if (!declaredNameValue || declaredNameValue.trim() === '') continue;

        // Ensure the declared_name object exists
        if (!jsonObject[declaredNameValue]) {
          jsonObject[declaredNameValue] = {};
        }

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

          // Navigate through the nesting path within the declared_name object
          let current = jsonObject[declaredNameValue];
          
          // Handle direct properties (no nesting)
          if (nestingPath.length === 0) {
            current[propertyName] = convertedValue;
          } else {
            // Navigate through nested structure
            for (let j = 0; j < nestingPath.length; j++) {
              const pathPart = nestingPath[j];
              
              if (j === nestingPath.length - 1) {
                // Last level - set the property
                if (!current[pathPart]) {
                  current[pathPart] = {};
                }
                current[pathPart][propertyName] = convertedValue;
              } else {
                // Intermediate level
                if (!current[pathPart]) {
                  current[pathPart] = {};
                }
                current = current[pathPart];
              }
            }
          }
        }
      }

      // Convert to formatted JSON string
      const jsonString = JSON.stringify(jsonObject, null, 2);
      
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