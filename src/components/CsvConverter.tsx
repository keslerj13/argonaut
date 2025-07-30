import React, { useState, useRef } from 'react';
import Papa from 'papaparse';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Upload, Download, FileText, CheckCircle, AlertCircle, Copy } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

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
  const { toast } = useToast();

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
        setError('CSV must have at least 5 rows (field name+type, data type, unit, field name, values)');
        return;
      }

      // Extract the rows
      const fieldNameAndTypeRow = rows[0]; // Row 1: field name and data type
      const dataTypeRow = rows[1]; // Row 2: just data type
      const unitRow = rows[2]; // Row 3: units
      const fieldNameRow = rows[3]; // Row 4: field names (with nesting)
      const valueRow = rows[4]; // Row 5: actual values

      // Create the JSON object
      const jsonObject: any = {};
      const nestedFields: string[] = [];
      const dataTypes = new Set<string>();

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

        // Handle nested fields (e.g., "dataSheet>filename")
        if (fieldName.includes('>')) {
          nestedFields.push(fieldName);
          const parts = fieldName.split('>');
          let current = jsonObject;
          
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
          jsonObject[fieldName.trim()] = convertValue(value, dataType, unit);
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

      toast({
        title: "Conversion successful!",
        description: `Converted ${fieldNameRow.filter(f => f && f.trim()).length} fields to JSON`,
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
      toast({
        title: "Copied!",
        description: "JSON output copied to clipboard",
      });
    } catch (err) {
      toast({
        title: "Copy failed",
        description: "Could not copy to clipboard",
        variant: "destructive",
      });
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
    
    toast({
      title: "Downloaded!",
      description: "JSON file has been downloaded",
    });
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
        <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-primary rounded-xl shadow-converter">
          <FileText className="w-8 h-8 text-converter-primary-foreground" />
        </div>
        <div>
          <h1 className="text-4xl font-bold bg-gradient-primary bg-clip-text text-transparent mb-2">
            CSV to JSON Converter
          </h1>
          <p className="text-lg text-muted-foreground">
            Convert structured CSV files to JSON with advanced mapping rules
          </p>
        </div>
      </div>

      {/* File Upload */}
      <Card className="shadow-converter">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Upload CSV File
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="border-2 border-dashed border-upload-border-dashed rounded-lg p-8 text-center transition-all duration-300 hover:border-upload-border hover:bg-muted/50 cursor-pointer"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            {file ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-converter-success">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm font-medium">Drop your CSV file here or click to browse</p>
                <p className="text-xs text-muted-foreground">
                  Must follow the 5-row format: field+type, data type, unit, field name, values
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
              <Button 
                onClick={processFile} 
                disabled={isProcessing}
                className="bg-upload-bg hover:bg-upload-bg-hover text-converter-accent-foreground transition-smooth"
              >
                {isProcessing ? 'Processing...' : 'Convert to JSON'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Error Display */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-6">
          {/* Summary Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-converter-success" />
                Conversion Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <div className="text-2xl font-bold text-converter-primary">{result.fieldCount}</div>
                  <div className="text-sm text-muted-foreground">Total Fields</div>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <div className="text-2xl font-bold text-converter-accent">{result.nestedFields.length}</div>
                  <div className="text-sm text-muted-foreground">Nested Fields</div>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <div className="text-2xl font-bold text-converter-warning">{result.dataTypes.length}</div>
                  <div className="text-sm text-muted-foreground">Data Types</div>
                </div>
              </div>
              
              {result.dataTypes.length > 0 && (
                <div className="mt-4">
                  <p className="text-sm font-medium mb-2">Data Types Found:</p>
                  <div className="flex flex-wrap gap-2">
                    {result.dataTypes.map((type, index) => (
                      <Badge key={index} variant="secondary">{type}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* JSON Output */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Generated JSON</CardTitle>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copyToClipboard}
                    className="flex items-center gap-2"
                  >
                    <Copy className="w-4 h-4" />
                    Copy
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={downloadJson}
                    className="flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    Download
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="bg-code-bg border border-code-border rounded-lg p-4 max-h-96 overflow-auto">
                <pre className="text-sm text-code-text whitespace-pre-wrap font-mono">
                  {result.jsonOutput}
                </pre>
              </div>
            </CardContent>
          </Card>

          {/* Conversion Rules */}
          <Card>
            <CardHeader>
              <CardTitle>Conversion Rules Applied</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 text-converter-success mt-0.5" />
                    <span>Nested fields with {">"} converted to nested objects</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 text-converter-success mt-0.5" />
                    <span>Array values in brackets [like this] parsed as JSON arrays</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 text-converter-success mt-0.5" />
                    <span>Numeric values auto-converted based on data types</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 text-converter-success mt-0.5" />
                    <span>Fields with units nested as {`{value, unit}`} objects</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 text-converter-success mt-0.5" />
                    <span>Empty values converted to null</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 text-converter-success mt-0.5" />
                    <span>Data types: real, int, string automatically detected</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default CsvConverter;