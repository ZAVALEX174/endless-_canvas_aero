// imageManager.js — extracted from main5.js
(function(global) {

function isLocalFileProtocol() {
  return typeof window !== 'undefined' && window.location && window.location.protocol === 'file:';
}

function resolveAssetUrl(assetPath) {
  if (!assetPath) return assetPath;
  if (/^(data:|blob:|https?:|file:)/i.test(assetPath)) return assetPath;
  try {
    return new URL(assetPath, window.location.href).href;
  } catch (error) {
    return assetPath;
  }
}

function loadFabricImage(assetPath, onSuccess, onError) {
  const resolvedUrl = resolveAssetUrl(assetPath);
  const imageElement = new Image();

  if (!isLocalFileProtocol() && !/^(data:|blob:)/i.test(resolvedUrl)) {
    imageElement.crossOrigin = 'anonymous';
  }

  imageElement.onload = () => {
    try {
      const fabricImage = new fabric.Image(imageElement);
      onSuccess(fabricImage, resolvedUrl);
    } catch (error) {
      if (typeof onError === 'function') onError(error, resolvedUrl);
    }
  };

  imageElement.onerror = (error) => {
    if (typeof onError === 'function') onError(error, resolvedUrl);
  };

  imageElement.src = resolvedUrl;
}

// Библиотека изображений
const defaultImages = [
  {
    id: 'fan1',
    name: 'Вентилятор основной',
    icon: '🌀',
    path: './img/fan.png',
    type: 'fan'
  },
  {
    id: 'fan2',
    name: 'Вентилятор',
    icon: '🌀',
    path: './img/fan2.png',
    type: 'fan'
  },
  {
    id: 'fire',
    name: 'Датчик пожарный',
    icon: '🔥',
    path: './img/fire.png',
    type: 'fire'
  },
  {
    id: 'fire2',
    name: 'Пожарный гидрант',
    icon: '🔥',
    path: './img/pozarniigidrant.png',
    type: 'fire'
  },
  {
    id: 'fire3',
    name: 'Пожарный склад',
    icon: '🔥',
    path: './img/scladprotivopozar.png',
    type: 'fire'
  },
  {
    id: 'valve',
    name: 'Дверь Закрытая',
    icon: '🔧',
    path: './img/dvercloses.png',
    type: 'valve'
  },
  {
    id: 'valve2',
    name: 'Дверь металлическая открытая',
    icon: '🔧',
    path: './img/dveropenmetall.png',
    type: 'valve'
  },
  {
    id: 'valve3',
    name: 'Дверь с вент решоткой',
    icon: '🔧',
    path: './img/dverventrech.png',
    type: 'valve'
  },
  {
    id: 'valve4',
    name: 'Дверь деревянная с вент окном',
    icon: '🔧',
    path: './img/dverwentoknowood.png',
    type: 'valve'
  },
  {
    id: 'valve5',
    name: 'Перемычка бетонная',
    icon: '🔧',
    path: './img/petemichkabeton.png',
    type: 'valve'
  },
  {
    id: 'valve6',
    name: 'Перемычка кирпичная',
    icon: '🔧',
    path: './img/petemichkakirpich.png',
    type: 'valve'
  },
  {
    id: 'valve7',
    name: 'Перемычка металлическая',
    icon: '🔧',
    path: './img/petemichkametall.png',
    type: 'valve'
  },
  {
    id: 'valve8',
    name: 'Перемычка деревянная',
    icon: '🔧',
    path: './img/petemichkawood.png',
    type: 'valve'
  },
  {
    id: 'valve9',
    name: 'Проход',
    icon: '🔧',
    path: './img/prohod.png',
    type: 'valve'
  },
  {
    id: 'valve10',
    name: 'Запасной вход',
    icon: '🔧',
    path: './img/zapasvhod.png',
    type: 'valve'
  },
  {
    id: 'atmosphere1',
    name: 'Атмосферная связь',
    icon: '🌤️',
    path: './img/nadshahtnoe.png',
    type: 'atmosphere'
  },
  {
    id: 'pump',
    name: 'Насос погружной',
    icon: '⚙️',
    path: './img/nanospogruznoi.png',
    type: 'pump'
  },
  {
    id: 'pump2',
    name: 'Насосная станция',
    icon: '⚙️',
    path: './img/nasosnayastancia.png',
    type: 'pump'
  },
  {
    id: 'sensor',
    name: 'Самоходное оборудование',
    icon: '📡',
    path: './img/samohodnoe.png',
    type: 'sensor'
  },
  {
    id: 'sensor2',
    name: 'Люди',
    icon: '📡',
    path: './img/people.png',
    type: 'sensor'
  },
  {
    id: 'sensor3',
    name: 'Телефон',
    icon: '📡',
    path: './img/phone.png',
    type: 'sensor'
  },
  {
    id: 'sensor4',
    name: 'Взрывные работы',
    icon: '📡',
    path: './img/vzrivnieraboti.png',
    type: 'sensor'
  },
  {
    id: 'sensor5',
    name: 'Массовые взрывные работы',
    icon: '📡',
    path: './img/massovievzivniepaboti.png',
    type: 'sensor'
  },
  {
    id: 'sensor6',
    name: 'Медпункт',
    icon: '📡',
    path: './img/medpunkt.png',
    type: 'sensor'
  },
  {
    id: 'sensor7',
    name: 'Надшахтное оборудование',
    icon: '📡',
    path: './img/nadshahtnoe.png',
    type: 'sensor'
  }
];
let allImages = [...defaultImages];

// Категории для табов правой панели
const IMAGE_CATEGORIES = {
  fans:       ['fan1', 'fan2'],
  structures: ['atmosphere1', 'pump', 'pump2', 'sensor', 'sensor7'],
  objects:    null // всё остальное
};

function buildImageGrid(containerId, images) {
  const grid = document.getElementById(containerId);
  if (!grid) return;
  grid.innerHTML = '';
  for (let img of images) {
    const btn = document.createElement('button');
    btn.className = 'image-item';
    btn.innerHTML = `<img src="${resolveAssetUrl(img.path)}" alt="${img.name}"><div>${img.name}</div>`;
    btn.onclick = function () { activateImagePlacementMode(img); };
    grid.appendChild(btn);
  }
}

function updateImageLibrary() {
  const fanIds = IMAGE_CATEGORIES.fans;
  const structureIds = IMAGE_CATEGORIES.structures;

  const fans = allImages.filter(img => fanIds.includes(img.id));
  const structures = allImages.filter(img => structureIds.includes(img.id));
  const objects = allImages.filter(img => !fanIds.includes(img.id) && !structureIds.includes(img.id));

  buildImageGrid('imageLibraryFans', fans);
  buildImageGrid('imageLibraryStructures', structures);
  buildImageGrid('imageLibraryObjects', objects);

  // Обратная совместимость — старый grid если вдруг есть
  const oldGrid = document.getElementById('imageLibraryGrid');
  if (oldGrid) {
    oldGrid.innerHTML = '';
    for (let img of allImages) {
      const btn = document.createElement('button');
      btn.className = 'image-item';
      btn.innerHTML = `<img src="${resolveAssetUrl(img.path)}" alt="${img.name}"><div>${img.name}</div>`;
      btn.onclick = function () { activateImagePlacementMode(img); };
      oldGrid.appendChild(btn);
    }
  }
}

function activateImagePlacementMode(image) {
  deactivateAllModes();
  currentImageData = image;
  const activeItems = document.querySelectorAll('.image-item.active');
  for (let it of activeItems) it.classList.remove('active');
  if (event && event.target) {
    const target = event.target.closest('.image-item');
    if (target) target.classList.add('active');
  }
  canvas.defaultCursor = 'crosshair';
  canvas.selection = false;
  showNotification(`Режим добавления: ${image.name}. Кликните на холст.`, 'info');
}

function addImageAtPosition(x, y) {
  if (!currentImageData) {
    showNotification('Выберите изображение!', 'error');
    return;
  }

  const selectedImageData = { ...currentImageData };

  loadFabricImage(selectedImageData.path, (img, resolvedUrl) => {
    const scale = Math.min(APP_CONFIG.MAX_IMAGE_SIZE / img.width, APP_CONFIG.MAX_IMAGE_SIZE / img.height, 1);
    img.set({
      left: snapToGrid(x), top: snapToGrid(y),
      scaleX: scale, scaleY: scale,
      originX: 'center', originY: 'center',
      hasControls: true, hasBorders: true,
      selectable: true,
      shadow: new fabric.Shadow({ color: (typeof getCV === 'function' ? getCV('--image-shadow-color') : 'rgba(255,255,255,0.45)') || 'rgba(255,255,255,0.45)', blur: 6, offsetX: 0, offsetY: 0 }),
      properties: synchronizeObjectDerivedProperties({
        name: selectedImageData.name,
        type: selectedImageData.type,
        imageId: selectedImageData.id,
        imagePath: selectedImageData.path,
        catalogKey: inferCatalogKey({ imageId: selectedImageData.id, name: selectedImageData.name }),
        width: img.width * scale,
        height: img.height * scale,
        number: typeof getNextElementNumber === 'function' ? getNextElementNumber() : undefined,
        layerId: typeof getActiveLayerId === 'function' ? getActiveLayerId() : 'default',
        airVolume: 0,
        airResistance: 0,
        fanMode: selectedImageData.type === 'fan' ? 'supply' : undefined,
        isFlowSource: selectedImageData.type === 'fan' ? true : undefined,
        doorMode: selectedImageData.type === 'valve' ? 'open' : undefined,
        windowArea: selectedImageData.type === 'valve' ? '1' : undefined,
        atmosphereHeight: selectedImageData.type === 'atmosphere' ? 0 : undefined,
        atmosphereTemp1: selectedImageData.type === 'atmosphere' ? 0 : undefined,
        atmosphereTemp2: selectedImageData.type === 'atmosphere' ? 0 : undefined,
        atmosphereSign: selectedImageData.type === 'atmosphere' ? 1 : undefined
      })
    });
    if (typeof applyLayerColorToObject === 'function') applyLayerColorToObject(img);
    saveToUndoStack();
    canvas.add(img);
    canvas.setActiveObject(img);
    canvas.renderAll();
    if (autoSplitMode) setTimeout(() => splitLinesAtImagePosition(img), 50);
    updatePropertiesPanel();
    showNotification(`${selectedImageData.name} добавлен`, 'success');
  }, (error, resolvedUrl) => {
    console.error('Ошибка загрузки изображения', resolvedUrl, error);
    const failedName = selectedImageData && selectedImageData.name ? selectedImageData.name : 'объект';
    showNotification(`Не удалось загрузить изображение: ${failedName}`, 'error');
  });
}

function splitLinesAtImagePosition(image) {
  const center = getObjectCenter(image);
  const lines = getCachedLines();
  let splitCount = 0;
  for (let line of lines) {
    const closest = findClosestPointOnLine(center, line);
    if (closest.param > 0.05 && closest.param < 0.95 && closest.distance < 30) {
      const nodeCheck = isPointInLockedNode(closest.x, closest.y);
      if (nodeCheck && nodeCheck.node.locked) continue;
      const split = splitLineAtPoint(line, { x: closest.x, y: closest.y });
      if (split) {
        saveToUndoStack();
        canvas.remove(line);
        removeAirVolumeText(line);
        canvas.add(split.line1);
        canvas.add(split.line2);
        if (typeof applyLayerColorToObject === 'function') {
          applyLayerColorToObject(split.line1);
          applyLayerColorToObject(split.line2);
        }
        createOrUpdateAirVolumeText(split.line1);
        createOrUpdateAirVolumeText(split.line2);
        splitCount++;
      }
    }
  }
  if (splitCount) {
    invalidateCache();
    updateConnectionGraph();
    // Поднимаем image поверх добавленных линий и текстов
    image.bringToFront();
    scheduleRender();
    showNotification(`Разделено ${splitCount} линий`, 'success');
  }
}

// Exports
global.isLocalFileProtocol = isLocalFileProtocol;
global.resolveAssetUrl = resolveAssetUrl;
global.loadFabricImage = loadFabricImage;
global.defaultImages = defaultImages;
global.allImages = allImages;
global.updateImageLibrary = updateImageLibrary;
global.activateImagePlacementMode = activateImagePlacementMode;
global.addImageAtPosition = addImageAtPosition;
global.splitLinesAtImagePosition = splitLinesAtImagePosition;

})(window);
