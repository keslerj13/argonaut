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
      
      if (rows.length < 5) {
        setError('CSV must have at least 5 rows (4 header rows + at least 1 data row)');
        return;
      }

      // Extract the header rows
      const fieldNameAndTypeRow = rows[0]; // Row 1: field name and data type
      const dataTypeRow = rows[1]; // Row 2: just data type
      const unitRow = rows[2]; // Row 3: units
      const fieldNameRow = rows[3]; // Row 4: field names (with nesting)
      
      // All remaining rows are data rows (from row 5 onwards)
      const dataRows = rows.slice(4);

      // Create an object to hold all JSON objects with declaredName as keys
      const jsonObject: any = {};
      const nestedFields: string[] = [];
      const dataTypes = new Set<string>();

      // Process each data row
      for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex++) {
        const valueRow = dataRows[rowIndex];
        const rowObject: any = {};
        let declaredNameValue = '';

        for (let i = 0; i < fieldNameRow.length; i++) {
          const fieldName = fieldNameRow[i];
          const value = valueRow[i];
          const dataType = dataTypeRow[i];
          const unit = unitRow[i];

          // Skip empty field names
          if (!fieldName || fieldName.trim() === '') continue;

          if (dataType && dataType.trim()) {
            dataTypes.add(dataType.trim());
          }

          // Handle nested fields (e.g., "dataSheet>filename") - only add to nestedFields once
          if (fieldName.includes('>') && rowIndex === 0) {
            nestedFields.push(fieldName);
          }

          // Capture declaredName value but don't add it to the object
          if (fieldName.trim() === 'declaredName') {
            declaredNameValue = value || '';
            continue;
          }

          if (fieldName.includes('>')) {
            const parts = fieldName.split('>');
            let current = rowObject;
            
            // Navigate/create nested structure
            for (let j = 0; j < parts.length - 1; j++) {
              const part = parts[j].trim();
              if (!current[part]) {
                current[part] = {};
              }
              current = current[part];
            }
            
            // Set the final value
            const finalKey = parts[parts.length - 1].trim();
            current[finalKey] = convertValue(value, dataType, unit);
          } else {
            // Simple field
            rowObject[fieldName.trim()] = convertValue(value, dataType, unit);
          }
        }
        
        // Use declaredName as the key for this object
        if (declaredNameValue) {
          jsonObject[declaredNameValue] = rowObject;
        }
      }

      // Convert to formatted JSON string
      const jsonString = JSON.stringify(jsonObject, null, 2);
      
      setResult({
        jsonOutput: jsonString,
        fieldCount: fieldNameRow.filter(f => f && f.trim()).length,
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
              CSV to JSON Converter
            </h1>
            <p style={{ fontSize: '18px', color: '#64748b' }}>
              Convert structured CSV files to JSON with advanced mapping rules
            </p>
          </div>
        </div>

        {/* File Upload */}
        <div style={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)', padding: '24px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Upload style={{ width: '20px', height: '20px' }} />
            Upload CSV File
          </h2>
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
                   <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#dc2626' }}>{Object.keys(JSON.parse(result.jsonOutput)).length}</div>
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

            {/* JSON Output */}
            <div style={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)', padding: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <h2 style={{ fontSize: '20px', fontWeight: '600' }}>Generated JSON</h2>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={copyToClipboard}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 12px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '14px', backgroundColor: 'white', cursor: 'pointer' }}
                  >
                    <Copy style={{ width: '16px', height: '16px' }} />
                    Copy
                  </button>
                  <button
                    onClick={downloadJson}
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