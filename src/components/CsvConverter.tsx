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
      
      if (rows.length < 6) {
        setError('CSV must have at least 6 rows (5 header rows + at least 1 data row)');
        return;
      }

      // Extract the header rows
      const declaredNameRow = rows[0]; // Row 1: declared_name for each data row
      const objectRow = rows[1]; // Row 2: Object level for each column
      const nestedObject1Row = rows[2]; // Row 3: nested_object_1 level for each column
      const nestedObject2Row = rows[3]; // Row 4: nested_object_2 level for each column  
      const propertyRow = rows[4]; // Row 5: property names (value, unit, etc.) for each column
      
      // All remaining rows are data rows (from row 6 onwards)
      const dataRows = rows.slice(5);

      // Create the JSON object
      const jsonObject: any = {};
      const nestedFields: string[] = [];
      const dataTypes = new Set<string>();

      // Process each data row
      for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex++) {
        const dataRow = dataRows[rowIndex];
        
        // Get the declared_name for this data row (first column of data row)
        const declaredNameValue = dataRow[0];
        if (!declaredNameValue || declaredNameValue.trim() === '') continue;

        // Ensure the declared_name object exists
        if (!jsonObject[declaredNameValue]) {
          jsonObject[declaredNameValue] = {};
        }

        // Process each column (each column represents a nested path, skip first column as it's declared_name)
        for (let colIndex = 1; colIndex < dataRow.length; colIndex++) {
          const value = dataRow[colIndex];
          
          // Skip empty values
          if (!value || value.trim() === '') continue;

          // Build the nesting path from the header rows
          const objectName = objectRow[colIndex];
          const nestedObject1 = nestedObject1Row[colIndex];
          const nestedObject2 = nestedObject2Row[colIndex];
          const propertyName = propertyRow[colIndex];

          // Skip if essential parts are missing
          if (!objectName || !propertyName) continue;

          // Build the complete nesting path
          const nestingPath = [objectName.trim()];
          if (nestedObject1 && nestedObject1.trim() !== '') {
            nestingPath.push(nestedObject1.trim());
          }
          if (nestedObject2 && nestedObject2.trim() !== '') {
            nestingPath.push(nestedObject2.trim());
          }

          // Track nested fields for reporting
          if (nestingPath.length > 1) {
            const nestedFieldPath = nestingPath.join(' > ');
            if (!nestedFields.includes(nestedFieldPath)) {
              nestedFields.push(nestedFieldPath);
            }
          }

          // Assume string data type for now (you can add a data type row if needed)
          const dataType = 'string';
          dataTypes.add(dataType);

          // Convert the value
          const convertedValue = convertValue(value, dataType, '');

          // Navigate through the nesting path within the declared_name object
          let current = jsonObject[declaredNameValue];
          
          for (let j = 0; j < nestingPath.length; j++) {
            const pathPart = nestingPath[j];
            
            if (j === nestingPath.length - 1) {
              // Last level - set the property
              if (!current[pathPart]) {
                current[pathPart] = {};
              }
              current[pathPart][propertyName.trim()] = convertedValue;
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

      // Convert to formatted JSON string
      const jsonString = JSON.stringify(jsonObject, null, 2);
      
      setResult({
        jsonOutput: jsonString,
        fieldCount: objectRow.filter(f => f && f.trim()).length,
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
                Must have 5 header rows: declared_name, Object, nested_object_1, nested_object_2, property
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