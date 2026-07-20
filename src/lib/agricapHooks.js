import { useState, useMemo } from 'react';

/**
 * Hook providing data filtering and search capabilities.
 * @param {Array} initialData - The raw dataset to filter
 * @param {Object} filterConfig - Configuration for filtering
 * @returns {Object} Bound filters, setters, and the filtered dataset
 */
export const useFilters = (initialData, filterConfig = {}) => {
  const [filters, setFilters] = useState({});
  const [searchTerm, setSearchTerm] = useState('');

  const updateFilter = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const filteredData = useMemo(() => {
    let result = Array.isArray(initialData) ? [...initialData] : [];

    // Text search
    if (searchTerm) {
      const lowerSearch = searchTerm.toLowerCase();
      result = result.filter(item => 
        Object.values(item).some(val => 
          String(val).toLowerCase().includes(lowerSearch)
        )
      );
    }

    // Exact match filters
    Object.entries(filters).forEach(([key, value]) => {
      if (value && value !== 'All') {
        result = result.filter(item => item[key] === value);
      }
    });

    return result;
  }, [initialData, filters, searchTerm]);

  return { filters, updateFilter, searchTerm, setSearchTerm, filteredData };
};

/**
 * Hook providing CSV export capabilities.
 * @returns {Object} Export functions
 */
export const useExport = () => {
  /**
   * Exports an array of objects to a CSV file.
   * @param {Array} data - The array of objects to export
   * @param {string} filename - Base filename for the download
   */
  const exportToCSV = (data, filename) => {
    if (!data || !data.length) return;
    const headers = Object.keys(data[0]).join(',');
    const rows = data.map(obj => 
      Object.values(obj).map(val => `"${String(val).replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    
    const csvContent = `data:text/csv;charset=utf-8,${headers}\n${rows}`;
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${filename}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return { exportToCSV };
};