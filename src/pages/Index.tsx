import React, { useState, useRef } from 'react';
import Papa from 'papaparse';
import { Upload, Download, FileText, CheckCircle, AlertCircle, Copy } from 'lucide-react';

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
  const [mode, setMode] = useState<'csv-to-json' | 'json-to-csv'>('csv-to-json');
  const [jsonInput, setJsonInput] = useState<string>('');
  
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
      
      if (rows.length < 2) {
        setError('CSV must have at least 2 rows (header row + at least 1 data row)');
        return;
      }

      // Get headers from first row
      const headers = rows[0];
      
      // Validate required columns
      const requiredColumns = ['Object', 'Data Type'];
      const missingColumns = requiredColumns.filter(col => !headers.includes(col));
      if (missingColumns.length > 0) {
        setError(`Missing required columns: ${missingColumns.join(', ')}`);
        return;
      }
      
      // Find column indices
      const getColumnIndex = (columnName: string) => headers.findIndex(h => h === columnName);
      
      const objectIndex = getColumnIndex('Object');
      const dataTypeIndex = getColumnIndex('Data Type');
      
      // Find all nested object columns (nested_object_1, nested_object_2, etc.)
      const nestedObjectColumns: { index: number; level: number }[] = [];
      headers.forEach((header, index) => {
        const match = header.match(/^nested_object_(\d+)$/);
        if (match) {
          nestedObjectColumns.push({ index, level: parseInt(match[1]) });
        }
      });
      
      // Sort by level
      nestedObjectColumns.sort((a, b) => a.level - b.level);
      
      // All remaining rows are data rows
      const dataRows = rows.slice(1);

      // Create the final JSON object
      const jsonObject: any = {};
      const nestedFields: string[] = [];
      const dataTypes = new Set<string>();

      // Process each data row
      for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex++) {
        const row = dataRows[rowIndex];
        
        const objectName = row[objectIndex];
        const dataType = row[dataTypeIndex];
        
        // Skip empty rows
        if (!objectName || objectName.trim() === '') continue;
        
        if (dataType && dataType.trim()) {
          dataTypes.add(dataType.trim());
        }

        // Build the nesting path
        const nestingPath = [objectName.trim()];
        
        // Add nested object levels
        for (const { index } of nestedObjectColumns) {
          const nestedValue = row[index];
          if (nestedValue && nestedValue.trim() !== '') {
            nestingPath.push(nestedValue.trim());
          }
        }
        
        // Track nested fields for reporting
        if (nestingPath.length > 1) {
          const nestedFieldPath = nestingPath.join(' > ');
          if (!nestedFields.includes(nestedFieldPath)) {
            nestedFields.push(nestedFieldPath);
          }
        }

        // Process all other columns as potential values
        for (let i = 0; i < headers.length; i++) {
          const header = headers[i];
          const value = row[i];
          
          // Skip system columns and empty values
          if (header === 'Object' || header === 'Data Type' || 
              header.startsWith('nested_object_') || 
              !value || value.trim() === '') {
            continue;
          }
          
          // Convert the value
          const convertedValue = convertValue(value, dataType, '');
          
          // Build the nested structure
          let current = jsonObject;
          
          // Navigate through the nesting path
          for (let j = 0; j < nestingPath.length; j++) {
            const pathPart = nestingPath[j];
            
            if (j === nestingPath.length - 1) {
              // Last level - check if we need to merge with existing object
              if (!current[pathPart]) {
                current[pathPart] = {};
              }
              // Set the property
              current[pathPart][header] = convertedValue;
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
        fieldCount: headers.length,
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

  const downloadOutput = () => {
    if (!result) return;
    
    const fileType = mode === 'csv-to-json' ? 'application/json' : 'text/csv';
    const fileExtension = mode === 'csv-to-json' ? '.json' : '.csv';
    const fileName = mode === 'csv-to-json' 
      ? (file?.name.replace('.csv', '.json') || 'converted.json')
      : 'converted.csv';
    
    const blob = new Blob([result.jsonOutput], { type: fileType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
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
                    {isProcessing ? 'Processing...' : 'Convert to JSON'}
                  </button>
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

        {/* Instruction Guide */}
        <div style={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)', padding: '24px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileText style={{ width: '20px', height: '20px' }} />
            CSV Format Instructions
          </h2>
          
          <div style={{ marginBottom: '16px' }}>
            <p style={{ fontSize: '14px', color: '#64748b', marginBottom: '12px' }}>
              Your CSV file must have these required columns:
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px', fontSize: '14px' }}>
              <span style={{ fontWeight: '500' }}>Object:</span>
              <span>The main object name (e.g., "Attribute")</span>
              <span style={{ fontWeight: '500' }}>Data Type:</span>
              <span>Data type (e.g., "real", "int", "string")</span>
              <span style={{ fontWeight: '500' }}>nested_object_1:</span>
              <span>First nesting level (e.g., "additional")</span>
              <span style={{ fontWeight: '500' }}>nested_object_2:</span>
              <span>Second nesting level (e.g., "operating_temperature_min")</span>
              <span style={{ fontWeight: '500' }}>value, unit, etc.:</span>
              <span>Property columns with actual data</span>
            </div>
          </div>

          <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '16px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: '500', marginBottom: '12px' }}>Example CSV Template:</h3>
            <pre style={{ fontSize: '12px', fontFamily: 'monospace', color: '#374151', whiteSpace: 'pre-wrap', margin: 0, overflow: 'auto' }}>
{`Object,Data Type,nested_object_1,nested_object_2,value,unit
Attribute,real,additional,operating_temperature_min,5,
Attribute,string,additional,operating_temperature_min,,degrees celsius
Attribute,real,electrical,voltage_max,24,V
Attribute,int,electrical,current_max,2,A`}
            </pre>
          </div>

          <div style={{ marginTop: '16px', padding: '12px', backgroundColor: '#fffbeb', border: '1px solid #fbbf24', borderRadius: '6px' }}>
            <p style={{ fontSize: '13px', color: '#92400e' }}>
              💡 <strong>Tip:</strong> Use multiple rows with the same nesting path to add multiple properties. 
              For example, both "value" and "unit" can be added to the same nested object by using separate rows.
            </p>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertCircle style={{ width: '16px', height: '16px', color: '#dc2626' }} />
              <p style={{ color: '#b91c1c' }}>{error}</p>
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
  );
};

export default Index;