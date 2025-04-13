// src/components/PayloadLoader.tsx
import React, { useState, useCallback } from 'react';
import { SchemaPayload, Schema } from '../types';

interface PayloadLoaderProps {
  onPayloadLoad: (payload: SchemaPayload) => void;
  onError: (errorMsg: string) => void;
}

const PayloadLoader: React.FC<PayloadLoaderProps> = ({ onPayloadLoad, onError }) => {
  const [payloadText, setPayloadText] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPayloadText(event.target.value);
  };

  const handleLoadClick = useCallback(() => {
    setIsLoading(true);
    onError(''); // Clear previous errors
    try {
      const parsed = JSON.parse(payloadText);

      // Basic validation of the payload structure
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('Payload must be a JSON object.');
      }
      if (typeof parsed.mainSchemaId !== 'string' || !parsed.mainSchemaId) {
        throw new Error('Payload must have a non-empty "mainSchemaId" string property.');
      }
      if (typeof parsed.schemas !== 'object' || parsed.schemas === null) {
         throw new Error('Payload must have a "schemas" object property.');
      }
      // Optional: Add deeper validation for each schema object within parsed.schemas if needed

      onPayloadLoad(parsed as SchemaPayload);
      // Optionally clear textarea after successful load
      // setPayloadText('');

    } catch (err: any) {
      console.error("Error parsing payload:", err);
      onError(`Error parsing payload: ${err.message}`);
      onPayloadLoad({ mainSchemaId: '', mainSchemaBasePath: '', schemas: {} }); // Clear schema on error
    } finally {
      setIsLoading(false);
    }
  }, [payloadText, onPayloadLoad, onError]);

  return (
    <div>
      <label htmlFor="payload-input">Paste Schema Payload (JSON):</label>
      <br />
      <textarea
        id="payload-input"
        rows={10}
        cols={80}
        value={payloadText}
        onChange={handleTextChange}
        placeholder='{\n  "mainSchemaId": "main.json",\n  "schemas": {\n    "main.json": { ... },\n    "ref1.json": { ... }\n  }\n}'
        style={{ fontFamily: 'monospace', fontSize: '12px' }}
      />
      <br />
      <button onClick={handleLoadClick} disabled={isLoading || !payloadText}>
        {isLoading ? 'Loading...' : 'Load Payload'}
      </button>
    </div>
  );
};

export default PayloadLoader;
