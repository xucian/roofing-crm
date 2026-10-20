import { useEffect, useState } from 'react';
import { replaceUrlParams } from '../app/url-params';

/** Longer values are not property ids; the link is ignored rather than sent to the pipeline. */
const MAX_ID_LENGTH = 64;

/** `?property=<property_id>`: the property whose drawer is open, so it can be shared as a link. */
export function readOpenProperty(params: URLSearchParams): string | null {
  const value = params.get('property')?.trim() ?? '';
  return value === '' || value.length > MAX_ID_LENGTH ? null : value;
}

/** The open property, starting from the URL and kept in it. */
export function useOpenProperty(): [string | null, (propertyId: string | null) => void] {
  const [propertyId, setPropertyId] = useState(() =>
    readOpenProperty(new URLSearchParams(window.location.search)),
  );
  useEffect(() => {
    replaceUrlParams([['property', propertyId]]);
  }, [propertyId]);
  return [propertyId, setPropertyId];
}
