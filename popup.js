document.addEventListener('DOMContentLoaded', function() {
  // Get DOM elements
  var statusElement = document.getElementById('status');
  var totalElement = document.getElementById('total');
  var displayTableButton = document.getElementById('displayTableButton');
  var downloadCsvButton = document.getElementById('downloadCsvButton');
  var tableContainer = document.getElementById('tableContainer');
  var timeBetweenPagesInput = document.getElementById('timeBetweenPages');
  var fileNameInput = document.getElementById('fileName');

  // Global variables to store data
  let globalHeaders = null;
  let globalData = [];

  // Function to convert data to CSV
  function convertToCSV(headers, data) {
      const csvRows = [];

      // Add headers
      csvRows.push(headers.join(','));

      // Add data rows
      data.forEach(row => {
          const values = headers.map(header => {
              const value = row[header] || '';
              // Escape quotes and wrap in quotes if contains comma or quotes
              return `"${value.replace(/"/g, '""')}"`;
          });
          csvRows.push(values.join(','));
      });

      return csvRows.join('\n');
  }

  // Function to download CSV
  function downloadCSV(headers, data) {
      const fileName = (fileNameInput.value || 'apollo_data') + '.csv';
      const csvContent = convertToCSV(headers, data);
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');

      if (navigator.msSaveBlob) { // IE 10+
          navigator.msSaveBlob(blob, fileName);
      } else {
          link.href = URL.createObjectURL(blob);
          link.setAttribute('download', fileName);
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
      }
  }

  // Function to scrape current page
  async function scrapePage(tabId) {
      return new Promise((resolve) => {
          chrome.scripting.executeScript({
              target: {tabId: tabId},
              function: function() {
                  // Find the treegrid
                  const treegrid = document.querySelector('[role="treegrid"]');
                  if (!treegrid) return null;

                  // Get header row
                  const headerRow = treegrid.querySelector('[role="row"]');
                  if (!headerRow) return null;

                  // Get all header cells and their text content, skip the first column
                  const headers = Array.from(headerRow.querySelectorAll('[role="columnheader"]'))
                      .slice(1)
                      .map(header => {
                          const span = header.querySelector('span');
                          return span ? span.textContent.trim() : '';
                      })
                      .filter(text => text && !text.includes('Quick Actions'));

                  // Get all data rows
                  const rows = Array.from(treegrid.querySelectorAll('[role="row"]')).slice(1);
                  const data = rows.map(row => {
                      const cells = Array.from(row.querySelectorAll('[role="cell"]'))
                          .slice(1);

                      const rowData = cells.map((cell, index) => {
                          let cellValue = '';

                          if (headers[index] === 'Links') {
                              const linkedInLink = cell.querySelector('a[href*="linkedin.com"]');
                              if (linkedInLink) {
                                  cellValue = linkedInLink.getAttribute('href') || '';
                              }
                          } else {
                              cellValue = cell.querySelector('a')?.textContent?.trim() ||
                                        cell.querySelector('span.zp_xvo3G')?.textContent?.trim() ||
                                        cell.querySelector('.zp_PTp8r')?.textContent?.trim() ||
                                        cell.textContent?.trim() ||
                                        '';
                          }

                          return cellValue.replace(/^\s+|\s+$/g, '');
                      });

                      return headers.reduce((acc, header, index) => {
                          acc[header] = rowData[index] || '';
                          return acc;
                      }, {});
                  });

                  // Check if next button is disabled
                  const nextButton = document.querySelector('button[aria-label="Next"]');
                  const isLastPage = nextButton ? nextButton.getAttribute('aria-disabled') === 'true' : true;

                  return { headers, data, isLastPage };
              },
          }, resolve);
      });
  }

  // Function to click next button
  async function clickNextButton(tabId) {
      return new Promise((resolve) => {
          chrome.scripting.executeScript({
              target: {tabId: tabId},
              function: function() {
                  const nextButton = document.querySelector('button[aria-label="Next"]');
                  if (nextButton && nextButton.getAttribute('aria-disabled') !== 'true') {
                      nextButton.click();
                      return true;
                  }
                  return false;
              },
          }, resolve);
      });
  }

  // Function to delay execution
  function delay(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Check if we're on an Apollo.io page
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      var currentTab = tabs[0];
      var baseUrl = currentTab.url;

      if (baseUrl.includes('https://app.apollo.io/')) {
          statusElement.textContent = "You found a list!";
          statusElement.style.fontSize = "20px";

          // Get the total contacts
          chrome.scripting.executeScript({
              target: {tabId: tabs[0].id},
              function: function() {
                  const allDivs = Array.from(document.getElementsByTagName('div'));
                  const paginationDiv = allDivs.find(div => {
                      const text = div.textContent.trim();
                      return /^\d+\s*-\s*\d+\s*of\s*\d+$/.test(text);
                  });

                  if (!paginationDiv) return 0;
                  const text = paginationDiv.textContent.trim();
                  const numbers = text.match(/\d+/g);
                  return numbers ? parseInt(numbers[2], 10) : 0;
              },
          }, function(results) {
              if (chrome.runtime.lastError) {
                  totalElement.textContent = 'Error getting total';
              } else {
                  const total = results[0].result;
                  totalElement.innerHTML = `<b>${total}</b> total contacts found`;
                  totalElement.style.fontSize = "20px";
              }
          });

          // Add click handler for scrape button
          displayTableButton.addEventListener('click', async function() {
              globalData = [];
              let isLastPage = false;
              const delaySeconds = parseInt(timeBetweenPagesInput.value) || 5;

              while (!isLastPage) {
                  // Scrape current page
                  const results = await scrapePage(currentTab.id);
                  const pageData = results[0].result;

                  if (!pageData) {
                      tableContainer.innerHTML = 'Error getting data';
                      break;
                  }

                  if (!globalHeaders) {
                      globalHeaders = pageData.headers;
                  }

                  globalData = globalData.concat(pageData.data);
                  isLastPage = pageData.isLastPage;

                  // Create table HTML
                  let tableHtml = '<table><tr>';
                  globalHeaders.forEach(header => {
                      tableHtml += `<th>${header}</th>`;
                  });
                  tableHtml += '</tr>';

                  globalData.forEach(row => {
                      tableHtml += '<tr>';
                      globalHeaders.forEach(header => {
                          const cellValue = row[header] || '';
                          if (header === 'Links' && cellValue.includes('linkedin.com')) {
                              tableHtml += `<td><a href="${cellValue}" target="_blank">${cellValue}</a></td>`;
                          } else {
                              tableHtml += `<td>${cellValue}</td>`;
                          }
                      });
                      tableHtml += '</tr>';
                  });

                  tableHtml += '</table>';
                  tableContainer.innerHTML = tableHtml;

                  if (!isLastPage) {
                      // Click next button and wait
                      const clickResult = await clickNextButton(currentTab.id);
                      if (!clickResult[0].result) {
                          break;
                      }
                      await delay(delaySeconds * 1000);
                  }
              }

              // Enable download button after scraping is complete
              downloadCsvButton.disabled = false;
          });

          // Add click handler for download CSV button
          downloadCsvButton.addEventListener('click', function() {
              if (globalHeaders && globalData.length > 0) {
                  downloadCSV(globalHeaders, globalData);
              } else {
                  alert('Please scrape data first before downloading CSV');
              }
          });

      } else {
          statusElement.textContent = "Please go to an Apollo.io List URL";
          statusElement.style.fontSize = "20px";
          displayTableButton.disabled = true;
          downloadCsvButton.disabled = true;
      }
  });
});
