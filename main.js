        // Inisialisasi peta
        const map = L.map('map').setView([-3.530038200467506, 112.5464096700536], 5);
        
        // Base layers
        const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        });
        
        const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: '© Esri, Maxar, Earthstar Geographics'
        });
        
        const darkLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '© CartoDB, © OpenStreetMap contributors'
        });
        
        // Add default layer
        satelliteLayer.addTo(map);
        
        // Layer control
        const baseLayers = {
            "🗺️ OpenStreetMap": osmLayer,
            "🛰️ Satelit": satelliteLayer,
            "🌙 Dark Mode": darkLayer
        };
        
        const layerControl = L.control.layers(baseLayers, null, {
            position: 'topright',
            collapsed: false
        }).addTo(map);

        // Variabel global
        let currentLayer = null;
        let currentData = [];
        let selectedAttributes = new Set();
        let analysisMode = null;
        let selectedPoints = [];
        let attributeChart = null;
        let analysisLayers = [];
        let currentAnalysisResults = null;
        let bufferPoint = null;

        // Event listeners
        document.getElementById('uploadArea').addEventListener('click', () => {
            document.getElementById('fileInput').click();
        });

        document.getElementById('fileInput').addEventListener('change', handleFileUpload);

        // Panel toggle functionality
        document.getElementById('leftToggle').addEventListener('click', toggleLeftPanel);
        document.getElementById('rightToggle').addEventListener('click', toggleRightPanel);


        // Drag & drop functionality
        const uploadArea = document.getElementById('uploadArea');
        
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                handleFile(files[0]);
            }
        });

        // Analysis buttons
        document.getElementById('distanceBtn').addEventListener('click', () => toggleAnalysisMode('distance'));
        document.getElementById('bufferBtn').addEventListener('click', () => toggleAnalysisMode('buffer'));
        document.getElementById('nearestBtn').addEventListener('click', () => toggleAnalysisMode('nearest'));
        document.getElementById('moranBtn').addEventListener('click', () => performMoranAnalysis());
        document.getElementById('ripleyBtn').addEventListener('click', () => performRipleyAnalysis());
        document.getElementById('refreshBtn').addEventListener('click', refreshAnalysis);
        
        // Buffer controls
        document.getElementById('radiusSlider').addEventListener('input', (e) => {
            document.getElementById('radiusValue').textContent = e.target.value;
        });
        document.getElementById('applyBufferBtn').addEventListener('click', applyBuffer);
        


        function handleFileUpload(event) {
            const file = event.target.files[0];
            if (file) {
                handleFile(file);
            }
        }

        function handleFile(file) {
            const fileName = file.name.toLowerCase();
            
            if (!fileName.endsWith('.kml') && !fileName.endsWith('.kmz') && 
                !fileName.endsWith('.xlsx') && !fileName.endsWith('.xls')) {
                showError('File harus berformat KML, KMZ, atau Excel (.xlsx/.xls)');
                return;
            }

            showLoading(true);
            
            if (fileName.endsWith('.kmz')) {
                handleKMZ(file);
            } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
                handleExcel(file);
            } else {
                const reader = new FileReader();
                reader.onload = function(e) {
                    try {
                        parseKML(e.target.result);
                    } catch (error) {
                        showError('Error parsing KML file: ' + error.message);
                        showLoading(false);
                    }
                };
                reader.readAsText(file);
            }
        }

        function handleKMZ(file) {
            const reader = new FileReader();
            reader.onload = function(e) {
                JSZip.loadAsync(e.target.result).then(function(zip) {
                    // Find KML file in the zip
                    let kmlFile = null;
                    Object.keys(zip.files).forEach(filename => {
                        if (filename.toLowerCase().endsWith('.kml')) {
                            kmlFile = zip.files[filename];
                        }
                    });
                    
                    if (kmlFile) {
                        kmlFile.async('text').then(function(kmlText) {
                            try {
                                parseKML(kmlText, zip);
                            } catch (error) {
                                showError('Error parsing KMZ file: ' + error.message);
                                showLoading(false);
                            }
                        });
                    } else {
                        showError('Tidak ada file KML ditemukan dalam KMZ');
                        showLoading(false);
                    }
                }).catch(function(error) {
                    showError('Error reading KMZ file: ' + error.message);
                    showLoading(false);
                });
            };
            reader.readAsArrayBuffer(file);
        }

        function handleExcel(file) {
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const workbook = XLSX.read(e.target.result, {type: 'array'});
                    const sheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[sheetName];
                    const data = XLSX.utils.sheet_to_json(worksheet);
                    
                    parseExcelData(data);
                } catch (error) {
                    showError('Error parsing Excel file: ' + error.message);
                    showLoading(false);
                }
            };
            reader.readAsArrayBuffer(file);
        }

        function parseExcelData(data) {
            if (data.length === 0) {
                showError('File Excel kosong');
                showLoading(false);
                return;
            }

            currentData = [];
            const allAttributes = new Set();

            // Clear existing layer
            if (currentLayer) {
                map.removeLayer(currentLayer);
            }

            currentLayer = L.layerGroup().addTo(map);

            // Find lat/lng columns
            const firstRow = data[0];
            const columns = Object.keys(firstRow);
            
            let latCol = null;
            let lngCol = null;
            
            // Try to find latitude and longitude columns
            columns.forEach(col => {
                const colLower = col.toLowerCase();
                if (colLower.includes('lat') || colLower.includes('y')) {
                    latCol = col;
                }
                if (colLower.includes('lng') || colLower.includes('lon') || colLower.includes('x')) {
                    lngCol = col;
                }
            });

            if (!latCol || !lngCol) {
                showError('Kolom latitude dan longitude tidak ditemukan. Pastikan ada kolom yang mengandung "lat" dan "lng"');
                showLoading(false);
                return;
            }

            data.forEach((row, index) => {
                const lat = parseFloat(row[latCol]);
                const lng = parseFloat(row[lngCol]);
                
                if (!isNaN(lat) && !isNaN(lng)) {
                    const attributes = {};
                    
                    // Add all columns as attributes
                    Object.keys(row).forEach(key => {
                        if (row[key] !== null && row[key] !== undefined && row[key] !== '') {
                            attributes[key] = row[key].toString();
                            allAttributes.add(key);
                        }
                    });

                    const pointData = {
                        lat: lat,
                        lng: lng,
                        attributes: attributes
                    };

                    currentData.push(pointData);

                    // Create marker
                    const marker = L.circleMarker([lat, lng], {
                        radius: 8,
                        fillColor: '#667eea',
                        color: '#4c51bf',
                        weight: 2,
                        opacity: 1,
                        fillOpacity: 0.8
                    });

                    // Add label
                    const Name = attributes.Name || attributes.name || attributes.NAMA || `Titik ${index + 1}`;
                    const label = L.divIcon({
                        className: 'point-label',
                        html: Name,
                        iconSize: [null, null],
                        iconAnchor: [null, -15]
                    });
                    
                    const labelMarker = L.marker([lat, lng], {icon: label}).addTo(currentLayer);

                    marker.on('click', () => handleMarkerClick(marker, pointData));
                    currentLayer.addLayer(marker);
                }
            });

            if (currentData.length > 0) {
                // Fit map to bounds
                const group = new L.featureGroup(currentLayer.getLayers());
                map.fitBounds(group.getBounds().pad(0.1));

                // Setup attributes
                setupAttributes(Array.from(allAttributes));
                
                // Create dashboard chart
                createDashboardChart();
                
                // Enable analysis buttons
                enableAnalysisButtons();
                
                showSuccess('File Excel berhasil dimuat! ' + currentData.length + ' titik ditampilkan.');
            } else {
                showError('Tidak ada titik valid ditemukan dalam file Excel');
            }

            showLoading(false);
        }

        function parseKML(kmlText, zipFile = null) {
            const parser = new DOMParser();
            const kmlDoc = parser.parseFromString(kmlText, 'text/xml');
            
            const placemarks = kmlDoc.getElementsByTagName('Placemark');
            
            if (placemarks.length === 0) {
                showError('Tidak ada data titik ditemukan dalam file KML');
                showLoading(false);
                return;
            }

            currentData = [];
            const allAttributes = new Set();

            // Clear existing layer
            if (currentLayer) {
                map.removeLayer(currentLayer);
            }

            currentLayer = L.layerGroup().addTo(map);

            for (let i = 0; i < placemarks.length; i++) {
                const placemark = placemarks[i];
                const coordinates = placemark.getElementsByTagName('coordinates')[0];
                
                if (coordinates) {
                    const coordText = coordinates.textContent.trim();
                    const [lng, lat] = coordText.split(',').map(Number);
                    
                    if (!isNaN(lat) && !isNaN(lng)) {
                        // Extract attributes
                        const attributes = {};
                        const name = placemark.getElementsByTagName('name')[0];
                        const description = placemark.getElementsByTagName('description')[0];
                        
                        if (name) {
                            attributes['Name'] = name.textContent;
                            allAttributes.add('Name');
                        }
                        
                        if (description) {
                            attributes['Description'] = description.textContent;
                            allAttributes.add('Description');
                        }

                        // Extract extended data
                        const extendedData = placemark.getElementsByTagName('ExtendedData')[0];
                        if (extendedData) {
                            const simpleData = extendedData.getElementsByTagName('SimpleData');
                            for (let j = 0; j < simpleData.length; j++) {
                                const data = simpleData[j];
                                const attrName = data.getAttribute('name');
                                const attrValue = data.textContent;
                                attributes[attrName] = attrValue;
                                allAttributes.add(attrName);
                            }
                        }

                        const pointData = {
                            lat: lat,
                            lng: lng,
                            attributes: attributes
                        };

                        currentData.push(pointData);

                        // Create marker
                        const marker = L.circleMarker([lat, lng], {
                            radius: 8,
                            fillColor: '#667eea',
                            color: '#4c51bf',
                            weight: 2,
                            opacity: 1,
                            fillOpacity: 0.8
                        });

                        // Add label
                        const Name = attributes.Name || attributes.name || `Titik ${i + 1}`;
                        const label = L.divIcon({
                            className: 'point-label',
                            html: Name,
                            iconSize: [null, null],
                            iconAnchor: [null, -15]
                        });
                        
                        const labelMarker = L.marker([lat, lng], {icon: label}).addTo(currentLayer);

                        marker.on('click', () => handleMarkerClick(marker, pointData, zipFile));
                        currentLayer.addLayer(marker);
                    }
                }
            }

            if (currentData.length > 0) {
                // Fit map to bounds
                const group = new L.featureGroup(currentLayer.getLayers());
                map.fitBounds(group.getBounds().pad(0.1));

                // Setup attributes
                setupAttributes(Array.from(allAttributes));
                
                // Create dashboard chart
                createDashboardChart();
                
                // Enable analysis buttons
                enableAnalysisButtons();
                
                showSuccess('File KML berhasil dimuat! ' + currentData.length + ' titik ditampilkan.');
            } else {
                showError('Tidak ada titik valid ditemukan dalam file KML');
            }

            showLoading(false);
        }

        function classifyANN(zScore, Rratio = null) {
            let kelas;

            if (zScore <= -2.58) { kelas = "Sangat Terklaster"; }
            else if (zScore <= -1.96) { kelas = "Terklaster"; }
            else if (zScore <= -1.65) { kelas = "Terklaster (lemah)"; }
            else if (zScore < 1.65) { kelas = "Acak (tidak signifikan)"; }
            else if (zScore < 1.96) { kelas = "Tersebar (lemah)"; }
            else if (zScore < 2.58) { kelas = "Tersebar"; }
            else { kelas = "Sangat Tersebar"; }

            return kelas;
        }

        function setupAttributes(attributes) {
            const attributesList = document.getElementById('attributesList');
            attributesList.innerHTML = '';
            
            selectedAttributes.clear();
            
            attributes.forEach(attr => {
                const item = document.createElement('div');
                item.className = 'attribute-item';
                
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'attribute-checkbox';
                checkbox.id = 'attr_' + attr;
                checkbox.checked = true;
                selectedAttributes.add(attr);
                
                checkbox.addEventListener('change', (e) => {
                    if (e.target.checked) {
                        selectedAttributes.add(attr);
                    } else {
                        selectedAttributes.delete(attr);
                    }
                });
                
                const label = document.createElement('label');
                label.htmlFor = 'attr_' + attr;
                label.textContent = attr;
                label.style.cursor = 'pointer';
                
                item.appendChild(checkbox);
                item.appendChild(label);
                attributesList.appendChild(item);
            });
            
            document.getElementById('attributesSection').style.display = 'block';
        }

        function handleMarkerClick(marker, pointData, zipFile = null) {
            if (analysisMode === 'distance' || analysisMode === 'buffer') {
                handleAnalysisClick(marker, pointData);
                return;
            }

            // Generate unique ID for this popup
            const popupId = 'popup_' + Date.now();
            
            // Get available name attributes
            const nameAttributes = Object.keys(pointData.attributes).filter(attr => 
                attr.toLowerCase().includes('name') || 
                attr.toLowerCase().includes('nama') || 
                attr.toLowerCase().includes('title') || 
                attr.toLowerCase().includes('judul') ||
                attr.toLowerCase().includes('label')
            );
            
            // If no name attributes found, use all attributes as options
            const displayOptions = nameAttributes.length > 0 ? nameAttributes : Object.keys(pointData.attributes);
            
            // Get current display name
            let currentDisplayName = pointData.attributes.Name || 
                                   pointData.attributes.name || 
                                   pointData.attributes.NAMA || 
                                   displayOptions[0] ? pointData.attributes[displayOptions[0]] : 'Titik';

            // Regular popup
            let popupContent = '<div class="popup-content">';
            
            // Header with name selector
            popupContent += '<div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">';
            popupContent += '<div style="flex: 1;">';
            popupContent += '<h4 style="margin: 0 0 0.5rem 0; color: #2d3748; font-size: 1rem;">Detail Informasi</h4>';
            
            // Name selector dropdown
            if (displayOptions.length > 1) {
                popupContent += '<div style="margin-bottom: 0.5rem;">';
                popupContent += '<label style="font-size: 0.8rem; color: #4a5568; display: block; margin-bottom: 0.25rem;">Tampilkan sebagai:</label>';
                popupContent += `<select id="${popupId}_nameSelector" onchange="updatePopupTitle('${popupId}')" style="width: 100%; padding: 0.25rem 0.5rem; border: 1px solid #cbd5e0; border-radius: 6px; font-size: 0.85rem; background: white;">`;
                
                displayOptions.forEach(attr => {
                    const selected = (pointData.attributes[attr] === currentDisplayName) ? 'selected' : '';
                    popupContent += `<option value="${attr}" ${selected}>${attr}: ${pointData.attributes[attr]}</option>`;
                });
                
                popupContent += '</select>';
                popupContent += '</div>';
            }
            
            // Display current name
            popupContent += `<div id="${popupId}_displayName" style="font-weight: 600; color: #667eea; font-size: 1.1rem; padding: 0.5rem; background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%); border-radius: 8px; border-left: 3px solid #667eea;">${currentDisplayName}</div>`;
            popupContent += '</div>';
            
            popupContent += '<button onclick="closeCurrentPopup()" style="background: none; border: none; color: #718096; cursor: pointer; font-size: 1.4rem; padding: 0; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 50%; transition: all 0.2s ease; flex-shrink: 0;" onmouseover="this.style.background=\'#f7fafc\'; this.style.color=\'#e53e3e\'" onmouseout="this.style.background=\'none\'; this.style.color=\'#718096\'">×</button>';
            popupContent += '</div>';
            popupContent += '</div>';
            
            // Coordinates info
            popupContent += '<div style="margin-bottom: 0.75rem; padding: 0.5rem; background: #f7fafc; border-radius: 6px; font-size: 0.85rem;">';
            popupContent += '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">';
            popupContent += `<div><span style="color: #4a5568; font-weight: 500;">Latitude:</span><br><span style="color: #2d3748;">${pointData.lat.toFixed(6)}</span></div>`;
            popupContent += `<div><span style="color: #4a5568; font-weight: 500;">Longitude:</span><br><span style="color: #2d3748;">${pointData.lng.toFixed(6)}</span></div>`;
            popupContent += '</div>';
            popupContent += '</div>';
            
            // Attributes section
            popupContent += '<div style="max-height: 300px; overflow-y: auto;">';
            popupContent += '<h5 style="margin-bottom: 0.5rem; color: #2d3748; font-size: 0.9rem; display: flex; align-items: center; gap: 0.5rem;"><i class="fas fa-list" style="color: #667eea;"></i>Atribut Data</h5>';
            
            selectedAttributes.forEach(attr => {
                if (pointData.attributes[attr]) {
                    const value = pointData.attributes[attr];
                    
                    // Check if it's an image reference
                    if (zipFile && (value.toLowerCase().includes('.jpg') || 
                                   value.toLowerCase().includes('.jpeg') || 
                                   value.toLowerCase().includes('.png') || 
                                   value.toLowerCase().includes('.gif'))) {
                        
                        // Try to find the image in the zip file
                        const imageFile = zipFile.files[value] || zipFile.files['files/' + value];
                        if (imageFile) {
                            imageFile.async('base64').then(function(base64) {
                                const imgElement = document.querySelector(`#img-${attr.replace(/\s+/g, '')}`);
                                if (imgElement) {
                                    imgElement.src = `data:image/jpeg;base64,${base64}`;
                                    imgElement.style.display = 'block';
                                }
                            });
                            
                            popupContent += `
                                <div class="popup-attribute" style="margin-bottom: 0.75rem; padding: 0.5rem; background: white; border-radius: 6px; border-left: 3px solid #667eea;">
                                    <span class="popup-label" style="font-weight: 500; color: #4a5568; font-size: 0.85rem;">${attr}:</span><br>
                                    <img id="img-${attr.replace(/\s+/g, '')}" style="max-width: 200px; max-height: 150px; display: none; margin-top: 5px; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" />
                                </div>
                            `;
                        } else {
                            popupContent += `
                                <div class="popup-attribute" style="margin-bottom: 0.5rem; padding: 0.5rem; background: white; border-radius: 6px; border-left: 3px solid #667eea;">
                                    <span class="popup-label" style="font-weight: 500; color: #4a5568; font-size: 0.85rem;">${attr}:</span>
                                    <div class="popup-value" style="color: #2d3748; margin-top: 0.25rem; font-size: 0.9rem;">${value}</div>
                                </div>
                            `;
                        }
                    } else {
                        // Check if value is a URL
                        const isUrl = value.toString().match(/^https?:\/\/.+/);
                        
                        popupContent += `
                            <div class="popup-attribute" style="margin-bottom: 0.5rem; padding: 0.5rem; background: white; border-radius: 6px; border-left: 3px solid #667eea;">
                                <span class="popup-label" style="font-weight: 500; color: #4a5568; font-size: 0.85rem;">${attr}:</span>
                                <div class="popup-value" style="color: #2d3748; margin-top: 0.25rem; font-size: 0.9rem; word-break: break-word;">
                                    ${isUrl ? `<a href="${value}" target="_blank" style="color: #667eea; text-decoration: none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${value} <i class="fas fa-external-link-alt" style="font-size: 0.7rem;"></i></a>` : value}
                                </div>
                            </div>
                        `;
                    }
                }
            });
            
            popupContent += '</div>';
            
            // Action buttons
            popupContent += '<div style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #e2e8f0; display: flex; gap: 0.5rem;">';
            popupContent += `<button onclick="zoomToPoint({lat: ${pointData.lat}, lng: ${pointData.lng}, attributes: ${JSON.stringify(pointData.attributes).replace(/"/g, '&quot;')}})" style="flex: 1; background: #667eea; color: white; border: none; padding: 0.5rem; border-radius: 6px; font-size: 0.8rem; cursor: pointer; transition: all 0.2s ease;" onmouseover="this.style.background='#5a67d8'" onmouseout="this.style.background='#667eea'"><i class="fas fa-crosshairs"></i> Zoom</button>`;
            popupContent += `<button onclick="copyCoordinates(${pointData.lat}, ${pointData.lng})" style="flex: 1; background: #38a169; color: white; border: none; padding: 0.5rem; border-radius: 6px; font-size: 0.8rem; cursor: pointer; transition: all 0.2s ease;" onmouseover="this.style.background='#2f855a'" onmouseout="this.style.background='#38a169'"><i class="fas fa-copy"></i> Copy</button>`;
            popupContent += '</div>';
            
            popupContent += '</div>';
            
            // Store popup data for name selector
            window.popupData = window.popupData || {};
            window.popupData[popupId] = pointData;
            
            const popup = L.popup({
                maxWidth: 380,
                className: 'custom-popup',
                closeButton: false,
                autoClose: true,
                closeOnClick: true,
                closeOnEscapeKey: true
            }).setContent(popupContent);
            
            marker.bindPopup(popup).openPopup();
        }

        // Global function to close popup
        window.closeCurrentPopup = function() {
            map.closePopup();
        };

        // Global function to update popup title based on selected attribute
        window.updatePopupTitle = function(popupId) {
            const selector = document.getElementById(popupId + '_nameSelector');
            const displayElement = document.getElementById(popupId + '_displayName');
            const pointData = window.popupData[popupId];
            
            if (selector && displayElement && pointData) {
                const selectedAttr = selector.value;
                const newDisplayName = pointData.attributes[selectedAttr] || 'Titik';
                displayElement.textContent = newDisplayName;
                
                // Add animation effect
                displayElement.style.transform = 'scale(1.05)';
                displayElement.style.transition = 'transform 0.2s ease';
                setTimeout(() => {
                    displayElement.style.transform = 'scale(1)';
                }, 200);
            }
        };

        // Global function to copy coordinates
        window.copyCoordinates = function(lat, lng) {
            const coordText = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
            
            // Try to use the modern clipboard API
            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(coordText).then(() => {
                    showSuccess('Koordinat berhasil disalin: ' + coordText);
                }).catch(() => {
                    // Fallback method
                    fallbackCopyText(coordText);
                });
            } else {
                // Fallback method for older browsers or non-secure contexts
                fallbackCopyText(coordText);
            }
        };

        // Fallback copy method
        function fallbackCopyText(text) {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            
            try {
                document.execCommand('copy');
                showSuccess('Koordinat berhasil disalin: ' + text);
            } catch (err) {
                showError('Gagal menyalin koordinat. Silakan salin manual: ' + text);
            }
            
            document.body.removeChild(textArea);
        }

        function createDashboardChart() {
            const ctx = document.getElementById('attributeChart').getContext('2d');
            
            if (attributeChart) {
                attributeChart.destroy();
            }
            
            // Count data points
            const dataCount = currentData.length;
            const attributeCount = selectedAttributes.size;
            
            attributeChart = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: ['Total Titik', 'Atribut Aktif'],
                    datasets: [{
                        data: [dataCount, attributeCount],
                        backgroundColor: ['#667eea', '#38a169'],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'right',
                            labels: {
                                font: {
                                    family: 'Poppins',
                                    size: 10
                                },
                                padding: 8,
                                usePointStyle: true,
                                pointStyle: 'circle'
                            }
                        }
                    },
                    layout: {
                        padding: 5
                    }
                }
            });
            
            // Create data list
            createDataList();
        }

        function createDataList() {
            const dataList = document.getElementById('dataList');
            dataList.innerHTML = '';
            
            currentData.forEach((point, index) => {
                const item = document.createElement('div');
                item.className = 'data-item';
                item.onclick = () => zoomToPoint(point);
                
                const Name = point.attributes.Name || `Titik ${index + 1}`;
                const coords = `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;
                
                item.innerHTML = `
                    <div class="data-item-name">${Name}</div>
                    <div class="data-item-coords">${coords}</div>
                `;
                
                dataList.appendChild(item);
            });
        }

        function zoomToPoint(point) {
            map.setView([point.lat, point.lng], 18);
            
            // Find and highlight the marker temporarily
            currentLayer.eachLayer(layer => {
                if (layer.getLatLng && 
                    Math.abs(layer.getLatLng().lat - point.lat) < 0.0001 && 
                    Math.abs(layer.getLatLng().lng - point.lng) < 0.0001) {
                    
                    // Temporarily change style
                    const originalStyle = {
                        fillColor: layer.options.fillColor,
                        color: layer.options.color
                    };
                    
                    layer.setStyle({
                        fillColor: '#e53e3e',
                        color: '#c53030'
                    });
                    
                    // Reset after 3 seconds
                    setTimeout(() => {
                        layer.setStyle(originalStyle);
                    }, 3000);
                    
                    // Open popup immediately
                    setTimeout(() => {
                        layer.fire('click');
                    }, 200);
                }
            });
        }

        function enableAnalysisButtons() {
            document.getElementById('distanceBtn').disabled = false;
            document.getElementById('bufferBtn').disabled = false;
            document.getElementById('nearestBtn').disabled = false;
            document.getElementById('moranBtn').disabled = false;
            document.getElementById('ripleyBtn').disabled = false;
            document.getElementById('refreshBtn').disabled = false;
        }

        function toggleAnalysisMode(mode) {
            const buttons = document.querySelectorAll('.analysis-btn');
            buttons.forEach(btn => btn.classList.remove('active'));
            
            // Hide all controls first
            document.getElementById('bufferControls').style.display = 'none';
            
            if (analysisMode === mode) {
                analysisMode = null;
                selectedPoints = [];
                bufferPoint = null;
                clearAnalysisResults();
            } else {
                analysisMode = mode;
                document.getElementById(mode + 'Btn').classList.add('active');
                selectedPoints = [];
                bufferPoint = null;
                
                if (mode === 'buffer') {
                    document.getElementById('bufferControls').style.display = 'block';
                } else if (mode === 'nearest') {
                    performNearestNeighborAnalysis();
                }
            }
        }

        function handleAnalysisClick(marker, pointData) {
            if (analysisMode === 'distance') {
                selectedPoints.push({marker, pointData});
                marker.setStyle({fillColor: '#e53e3e', color: '#c53030'});
                
                if (selectedPoints.length === 2) {
                    calculateDistance();
                }
            } else if (analysisMode === 'buffer') {
                // Reset previous selection
                if (bufferPoint && bufferPoint.marker) {
                    bufferPoint.marker.setStyle({fillColor: '#667eea', color: '#4c51bf'});
                }
                
                bufferPoint = {marker, pointData};
                marker.setStyle({fillColor: '#38a169', color: '#2f855a'});
                
                showSuccess(`Titik buffer dipilih: ${pointData.attributes.Name || 'Titik'}. Atur radius dan klik "Terapkan Buffer".`);
            }
        }

        function calculateDistance() {
            const point1 = selectedPoints[0].pointData;
            const point2 = selectedPoints[1].pointData;
            
            const distance = map.distance([point1.lat, point1.lng], [point2.lat, point2.lng]);
            
            // Draw line
            const line = L.polyline([
                [point1.lat, point1.lng],
                [point2.lat, point2.lng]
            ], {color: '#e53e3e', weight: 3}).addTo(map);
            
            analysisLayers.push(line);
            
            showAnalysisResults('distance', {
                distance: distance,
                point1: point1.attributes.Name || 'Titik 1',
                point2: point2.attributes.Name || 'Titik 2'
            });
            
            // Reset
            setTimeout(() => {
                selectedPoints.forEach(p => {
                    p.marker.setStyle({fillColor: '#667eea', color: '#4c51bf'});
                });
                selectedPoints = [];
                analysisMode = null;
                document.getElementById('distanceBtn').classList.remove('active');
            }, 100);
        }

        function applyBuffer() {
            if (!bufferPoint) {
                showError('Pilih titik untuk buffer terlebih dahulu!');
                return;
            }
            
            const radius = parseInt(document.getElementById('radiusSlider').value);
            createBuffer(bufferPoint.pointData, radius);
        }

        function createBuffer(pointData, radius) {
            // Clear previous buffer
            analysisLayers.forEach(layer => {
                if (map.hasLayer(layer)) {
                    map.removeLayer(layer);
                }
            });
            analysisLayers = [];
            
            const circle = L.circle([pointData.lat, pointData.lng], {
                radius: radius,
                fillColor: '#38a169',
                color: '#2f855a',
                weight: 2,
                opacity: 0.8,
                fillOpacity: 0.2
            }).addTo(map);
            
            analysisLayers.push(circle);
            
            // Count points within buffer and collect their data
            let pointsInBuffer = 0;
            let bufferPoints = [];
            currentData.forEach(point => {
                const distance = map.distance([pointData.lat, pointData.lng], [point.lat, point.lng]);
                if (distance <= radius && distance > 0) {
                    pointsInBuffer++;
                    bufferPoints.push({
                        name: point.attributes.Name || `Titik ${currentData.indexOf(point) + 1}`,
                        distance: distance,
                        point: point,
                        attributes: point.attributes
                    });
                }
            });
            
            // Sort by distance
            bufferPoints.sort((a, b) => a.distance - b.distance);
            
            currentAnalysisResults = {
                type: 'buffer',
                center: pointData.attributes.Name || 'Titik Terpilih',
                radius: radius,
                pointsInBuffer: pointsInBuffer,
                bufferPoints: bufferPoints,
                centerPoint: pointData
            };
            
            showAnalysisResults('buffer', currentAnalysisResults);
        }

        function performNearestNeighborAnalysis() {
            if (currentData.length < 2) {
                showError('Minimal 2 titik diperlukan untuk analisis Nearest Neighbor');
                return;
            }
            
            let totalDistance = 0;
            let minDistance = Infinity;
            let maxDistance = 0;
            let connections = 0;
            let minPair = null;
            let maxPair = null;
            
            currentData.forEach((point, i) => {
                let nearestDistance = Infinity;
                let nearestPoint = null;
                
                currentData.forEach((otherPoint, j) => {
                    if (i !== j) {
                        const distance = map.distance([point.lat, point.lng], [otherPoint.lat, otherPoint.lng]);
                        if (distance < nearestDistance) {
                            nearestDistance = distance;
                            nearestPoint = otherPoint;
                        }
                    }
                });
                
                if (nearestPoint) {
                    totalDistance += nearestDistance;
                    
                    if (nearestDistance < minDistance) {
                        minDistance = nearestDistance;
                        minPair = {
                            point1: point.attributes.Name || `Titik ${i + 1}`,
                            point2: nearestPoint.attributes.Name || 'Titik'
                        };
                    }
                    
                    if (nearestDistance > maxDistance) {
                        maxDistance = nearestDistance;
                        maxPair = {
                            point1: point.attributes.Name || `Titik ${i + 1}`,
                            point2: nearestPoint.attributes.Name || 'Titik'
                        };
                    }
                    
                    connections++;
                    
                    // Draw connection line
                    const line = L.polyline([
                        [point.lat, point.lng],
                        [nearestPoint.lat, nearestPoint.lng]
                    ], {
                        color: '#667eea',
                        weight: 1,
                        opacity: 0.6,
                        dashArray: '5, 5'
                    }).addTo(map);
                    
                    analysisLayers.push(line);
                }
            });
            
            const avgDistance = totalDistance / connections;
            
            // Calculate z-score for ANN
            const n = currentData.length;
            const area = calculateBoundingBoxArea();
            const density = n / area;
            const expectedDistance = 0.5 / Math.sqrt(density);
            const standardError = 0.26136 / Math.sqrt(n * density);
            const zScore = (avgDistance - expectedDistance) / standardError;
            const rRatio = avgDistance / expectedDistance;
            
            const classification = classifyANN(zScore, rRatio);
            
            currentAnalysisResults = {
                type: 'nearest',
                totalPoints: currentData.length,
                avgDistance: avgDistance,
                minDistance: minDistance,
                maxDistance: maxDistance,
                minPair: minPair,
                maxPair: maxPair,
                zScore: zScore,
                rRatio: rRatio,
                classification: classification
            };
            
            showAnalysisResults('nearest', currentAnalysisResults);
        }

        function calculateBoundingBoxArea() {
            if (currentData.length === 0) return 1;
            
            let minLat = currentData[0].lat;
            let maxLat = currentData[0].lat;
            let minLng = currentData[0].lng;
            let maxLng = currentData[0].lng;
            
            currentData.forEach(point => {
                minLat = Math.min(minLat, point.lat);
                maxLat = Math.max(maxLat, point.lat);
                minLng = Math.min(minLng, point.lng);
                maxLng = Math.max(maxLng, point.lng);
            });
            
            // Convert to approximate area in square meters
            const latDiff = (maxLat - minLat) * 111320; // meters per degree latitude
            const lngDiff = (maxLng - minLng) * 111320 * Math.cos((minLat + maxLat) / 2 * Math.PI / 180);
            
            return Math.max(latDiff * lngDiff, 1000000); // minimum 1 km²
        }

        function showAnalysisResults(type, data) {
            const resultsContainer = document.getElementById('resultsContainer');
            const analysisResults = document.getElementById('analysisResults');
            
            let content = '';
            
            if (type === 'distance') {
                content = `
                    <div class="stats-grid">
                        <div class="stat-card">
                            <div class="stat-value">${(data.distance / 1000).toFixed(2)}</div>
                            <div class="stat-label">Kilometer</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value">${data.distance.toFixed(0)}</div>
                            <div class="stat-label">Meter</div>
                        </div>
                    </div>
                    <p style="margin-top: 1rem; font-size: 0.9rem; color: #718096;">
                        Jarak antara <strong>${data.point1}</strong> dan <strong>${data.point2}</strong>
                    </p>
                `;
            } else if (type === 'buffer') {
                content = `
                    <div class="stats-grid">
                        <div class="stat-card">
                            <div class="stat-value">${(data.radius / 1000).toFixed(1)}</div>
                            <div class="stat-label">Radius (km)</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value">${data.pointsInBuffer}</div>
                            <div class="stat-label">Titik dalam Buffer</div>
                        </div>
                    </div>
                    <p style="margin-top: 1rem; font-size: 0.9rem; color: #718096;">
                        Buffer dari <strong>${data.center}</strong>
                    </p>
                `;
                
                if (data.bufferPoints && data.bufferPoints.length > 0) {
                    content += `
                        <div style="margin-top: 1rem; padding: 1rem; background: white; border-radius: 8px;">
                            <h5 style="margin-bottom: 0.75rem; color: #2d3748;">Titik dalam Buffer:</h5>
                            <div style="max-height: 200px; overflow-y: auto;">
                    `;
                    
                    data.bufferPoints.forEach((bufferPoint, index) => {
                        content += `
                            <div class="data-item" onclick="zoomToBufferPoint('${bufferPoint.point.lat}', '${bufferPoint.point.lng}')" style="margin-bottom: 0.5rem; cursor: pointer;">
                                <div class="data-item-name">${bufferPoint.name}</div>
                                <div class="data-item-coords">Jarak: ${bufferPoint.distance.toFixed(0)} meter</div>
                            </div>
                        `;
                    });
                    
                    content += `
                            </div>
                        </div>
                    `;
                }
            } else if (type === 'nearest') {
                content = `
                    <div class="stats-grid">
                        <div class="stat-card">
                            <div class="stat-value">${data.totalPoints}</div>
                            <div class="stat-label">Total Titik</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value">${data.avgDistance.toFixed(0)}</div>
                            <div class="stat-label">Rata-rata (m)</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value">${data.minDistance.toFixed(0)}</div>
                            <div class="stat-label">Terdekat (m)</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value">${data.maxDistance.toFixed(0)}</div>
                            <div class="stat-label">Terjauh (m)</div>
                        </div>
                    </div>
                    <div style="margin-top: 1rem; padding: 1rem; background: white; border-radius: 8px;">
                        <h5 style="margin-bottom: 0.5rem; color: #2d3748;">Klasifikasi ANN:</h5>
                        <p style="font-weight: 500; color: #667eea; margin-bottom: 0.5rem;">${data.classification}</p>
                        <p style="font-size: 0.85rem; color: #718096; margin-bottom: 0.25rem;">
                            <strong>Z-Score:</strong> ${data.zScore.toFixed(3)}
                        </p>
                        <p style="font-size: 0.85rem; color: #718096; margin-bottom: 0.5rem;">
                            <strong>R-Ratio:</strong> ${data.rRatio.toFixed(3)}
                        </p>
                        <div style="font-size: 0.8rem; color: #4a5568;">
                            <p><strong>Jarak Terdekat:</strong> ${data.minPair.point1} ↔ ${data.minPair.point2} (${data.minDistance.toFixed(0)}m)</p>
                            <p><strong>Jarak Terjauh:</strong> ${data.maxPair.point1} ↔ ${data.maxPair.point2} (${data.maxDistance.toFixed(0)}m)</p>
                        </div>
                    </div>
                `;
            } else if (type === 'moran') {
                content = `
                    <div class="stats-grid">
                        <div class="stat-card">
                            <div class="stat-value">${data.moranI.toFixed(4)}</div>
                            <div class="stat-label">Moran's I</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value">${data.zScore.toFixed(3)}</div>
                            <div class="stat-label">Z-Score</div>
                        </div>
                    </div>
                    <div style="margin-top: 1rem; padding: 1rem; background: white; border-radius: 8px;">
                        <h5 style="margin-bottom: 0.5rem; color: #2d3748;">Interpretasi:</h5>
                        <p style="font-weight: 500; color: #667eea;">${data.interpretation}</p>
                        <p style="font-size: 0.85rem; color: #718096; margin-top: 0.5rem;">
                            Expected I: ${data.expectedI.toFixed(4)}
                        </p>
                    </div>
                `;
            } else if (type === 'ripley') {
                content = `
                    <div style="margin-bottom: 1rem; padding: 1rem; background: white; border-radius: 8px;">
                        <h5 style="margin-bottom: 0.5rem; color: #2d3748;">Pola Distribusi:</h5>
                        <p style="font-weight: 500; color: #667eea; margin-bottom: 0.5rem;">${data.pattern}</p>
                        <p style="font-size: 0.85rem; color: #718096;">
                            Rata-rata L(d) - d: ${data.avgDifference.toFixed(2)}
                        </p>
                    </div>
                    <div style="background: white; border-radius: 8px; padding: 1rem;">
                        <h5 style="margin-bottom: 0.75rem; color: #2d3748;">Hasil per Jarak:</h5>
                        <div style="max-height: 200px; overflow-y: auto;">
                `;
                
                data.results.forEach(result => {
                    content += `
                        <div style="padding: 0.5rem; margin-bottom: 0.5rem; background: #f7fafc; border-radius: 6px; font-size: 0.85rem;">
                            <div><strong>${result.distance}m:</strong> L(d) = ${result.lValue.toFixed(1)}, Expected = ${result.expectedL}</div>
                            <div style="color: ${result.difference > 0 ? '#38a169' : result.difference < 0 ? '#e53e3e' : '#718096'};">
                                Difference: ${result.difference.toFixed(2)}
                            </div>
                        </div>
                    `;
                });
                
                content += `
                        </div>
                    </div>
                `;
            }
            
            analysisResults.innerHTML = content;
            resultsContainer.style.display = 'block';
        }

        function performMoranAnalysis() {
            if (currentData.length < 3) {
                showError('Minimal 3 titik diperlukan untuk analisis Moran\'s I');
                return;
            }
            
            // Calculate Moran's I
            const n = currentData.length;
            let sumW = 0;
            let sumWX = 0;
            let sumX = 0;
            let sumX2 = 0;
            
            // Use latitude as the variable for simplicity
            const values = currentData.map(point => point.lat);
            const mean = values.reduce((a, b) => a + b, 0) / n;
            
            // Calculate weights and sums
            for (let i = 0; i < n; i++) {
                for (let j = 0; j < n; j++) {
                    if (i !== j) {
                        const distance = map.distance([currentData[i].lat, currentData[i].lng], 
                                                    [currentData[j].lat, currentData[j].lng]);
                        const weight = distance > 0 ? 1 / distance : 0;
                        sumW += weight;
                        sumWX += weight * (values[i] - mean) * (values[j] - mean);
                    }
                }
                sumX += values[i] - mean;
                sumX2 += Math.pow(values[i] - mean, 2);
            }
            
            const moranI = (n / sumW) * (sumWX / sumX2);
            const expectedI = -1 / (n - 1);
            const varianceI = (n * n - 3 * n + 3) / ((n - 1) * (n - 2) * (n - 3));
            const zScore = (moranI - expectedI) / Math.sqrt(varianceI);
            
            let interpretation = '';
            if (zScore > 1.96) interpretation = 'Autokorelasi Positif Signifikan (Terklaster)';
            else if (zScore < -1.96) interpretation = 'Autokorelasi Negatif Signifikan (Tersebar)';
            else interpretation = 'Tidak Ada Autokorelasi Spasial (Acak)';
            
            currentAnalysisResults = {
                type: 'moran',
                moranI: moranI,
                expectedI: expectedI,
                zScore: zScore,
                interpretation: interpretation
            };
            
            showAnalysisResults('moran', currentAnalysisResults);
        }
        
        function performRipleyAnalysis() {
            if (currentData.length < 5) {
                showError('Minimal 5 titik diperlukan untuk analisis Ripley\'s K');
                return;
            }
            
            const distances = [500, 1000, 1500, 2000, 2500]; // meters
            const results = [];
            const n = currentData.length;
            const area = calculateBoundingBoxArea();
            const density = n / area;
            
            distances.forEach(r => {
                let kValue = 0;
                
                currentData.forEach((point, i) => {
                    let count = 0;
                    currentData.forEach((otherPoint, j) => {
                        if (i !== j) {
                            const distance = map.distance([point.lat, point.lng], [otherPoint.lat, otherPoint.lng]);
                            if (distance <= r) {
                                count++;
                            }
                        }
                    });
                    kValue += count;
                });
                
                kValue = kValue / (n * density);
                const expectedK = Math.PI * r * r;
                const lValue = Math.sqrt(kValue / Math.PI);
                const expectedL = r;
                
                results.push({
                    distance: r,
                    kValue: kValue,
                    expectedK: expectedK,
                    lValue: lValue,
                    expectedL: expectedL,
                    difference: lValue - expectedL
                });
            });
            
            // Determine pattern
            const avgDifference = results.reduce((sum, r) => sum + r.difference, 0) / results.length;
            let pattern = '';
            if (avgDifference > 0) pattern = 'Terklaster (Clustered)';
            else if (avgDifference < 0) pattern = 'Tersebar (Dispersed)';
            else pattern = 'Acak (Random)';
            
            currentAnalysisResults = {
                type: 'ripley',
                results: results,
                pattern: pattern,
                avgDifference: avgDifference
            };
            
            showAnalysisResults('ripley', currentAnalysisResults);
        }
        
        function refreshAnalysis() {
            // Reset analysis mode
            analysisMode = null;
            selectedPoints = [];
            bufferPoint = null;
            currentAnalysisResults = null;
            
            // Remove active class from buttons
            document.querySelectorAll('.analysis-btn').forEach(btn => btn.classList.remove('active'));
            
            // Hide controls
            document.getElementById('bufferControls').style.display = 'none';
            
            // Clear analysis layers
            analysisLayers.forEach(layer => {
                if (map.hasLayer(layer)) {
                    map.removeLayer(layer);
                }
            });
            analysisLayers = [];
            
            // Reset marker styles
            if (currentLayer) {
                currentLayer.eachLayer(layer => {
                    if (layer.setStyle) {
                        layer.setStyle({
                            fillColor: '#667eea',
                            color: '#4c51bf'
                        });
                    }
                });
            }
            
            // Clear results
            clearAnalysisResults();
            
            showSuccess('Analisis berhasil direset!');
        }

        function clearAnalysisResults() {
            document.getElementById('resultsContainer').style.display = 'none';
        }

        function showLoading(show) {
            document.getElementById('loading').style.display = show ? 'block' : 'none';
        }

        function showSuccess(message) {
            const successMsg = document.getElementById('successMessage');
            successMsg.textContent = message;
            successMsg.style.display = 'block';
            setTimeout(() => {
                successMsg.style.display = 'none';
            }, 5000);
        }

        function showError(message) {
            const errorMsg = document.getElementById('errorMessage');
            document.getElementById('errorText').textContent = message;
            errorMsg.style.display = 'block';
            setTimeout(() => {
                errorMsg.style.display = 'none';
            }, 5000);
        }

        // Panel toggle functions
        function toggleLeftPanel() {
            const panel = document.getElementById('leftPanel');
            const toggle = document.getElementById('leftToggle');
            const icon = toggle.querySelector('i');
            
            panel.classList.toggle('panel-hidden');
            toggle.classList.toggle('hidden');
            
            if (panel.classList.contains('panel-hidden')) {
                icon.className = 'fas fa-chevron-right';
            } else {
                icon.className = 'fas fa-chevron-left';
            }
        }

        function toggleRightPanel() {
            const panel = document.getElementById('rightPanel');
            const toggle = document.getElementById('rightToggle');
            const icon = toggle.querySelector('i');
            
            panel.classList.toggle('panel-hidden');
            toggle.classList.toggle('hidden');
            
            if (panel.classList.contains('panel-hidden')) {
                icon.className = 'fas fa-chevron-left';
            } else {
                icon.className = 'fas fa-chevron-right';
            }
        }



        // Global function for buffer point zoom
        window.zoomToBufferPoint = function(lat, lng) {
            const point = currentData.find(p => 
                Math.abs(p.lat - parseFloat(lat)) < 0.0001 && 
                Math.abs(p.lng - parseFloat(lng)) < 0.0001
            );
            if (point) {
                zoomToPoint(point);
            }
        }