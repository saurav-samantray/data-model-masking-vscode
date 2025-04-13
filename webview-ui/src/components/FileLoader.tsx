import React, { useState, useCallback } from 'react';
import jsYaml from 'js-yaml';
import { Schema } from '../types';

interface FileLoaderProps {
  onSchemaLoad: (schema: Schema, fileName: string) => void;
  onError: (errorMsg: string) => void;
}

const FileLoader: React.FC<FileLoaderProps> = ({ onSchemaLoad, onError }) => {
  const [isLoading, setIsLoading] = useState(false);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setIsLoading(true);
    onError(''); // Clear previous errors
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        let schema: Schema | null = null;

        if (file.name.endsWith('.yaml') || file.name.endsWith('.yml')) {
          const loadedYaml = jsYaml.load(content);
          if (typeof loadedYaml === 'object' && loadedYaml !== null) {
            schema = loadedYaml as Schema;
          } else {
            throw new Error('YAML content did not parse to an object.');
          }
        } else {
          // Assume JSON for other types
          schema = JSON.parse(content);
        }

        if (schema && typeof schema === 'object') {
          onSchemaLoad(schema, file.name);
        } else {
           throw new Error('Parsed content is not a valid schema object.');
        }
      } catch (err: any) {
        console.error("Error parsing file:", err);
        onError(`Error parsing file "${file.name}": ${err.message}`);
        onSchemaLoad({} as Schema, ''); // Clear schema on error
      } finally {
        setIsLoading(false);
        // Reset file input value to allow reloading the same file
         if (event.target) {
            event.target.value = '';
         }
      }
    };

    reader.onerror = (e) => {
      console.error("Error reading file:", e);
      onError(`Error reading file "${file.name}".`);
      setIsLoading(false);
       if (event.target) {
            event.target.value = '';
       }
    };

    reader.readAsText(file);
  }, [onSchemaLoad, onError]);

  return (
    <div>
      <label htmlFor="schema-file-input">Load Schema (JSON or YAML): </label>
      <input
        id="schema-file-input"
        type="file"
        accept=".json,.yaml,.yml"
        onChange={handleFileChange}
        disabled={isLoading}
      />
      {isLoading && <span> Loading...</span>}
    </div>
  );
};

export default FileLoader;
