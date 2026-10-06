# План реализации страницы Книги (Book Page UI)

Данный документ описывает архитектуру и шаги по реализации страницы книги в Aquilum на основе предоставленных HTML-макетов (из Figma). 

## 1. Архитектура компонентов
Мы будем использовать строгий компонентный подход. Весь UI будет разбит на следующие компоненты:

- **`BookPage`** (Обертка страницы): Главный контейнер, который управляет состоянием (Live Preview vs Raw Markdown) и организует слои.
- **`PageCover`** (Обложка страницы): 
  - Верхний баннер.
  - Содержит загруженное изображение.
  - Содержит сложный слой градиентов (`mix-blend-mode: color-dodge/overlay`, фильтры размытия).
  - Включает кнопку "Читать" и панель управления обложкой.
- **`BookCover`** (Обложка книги): 
  - "Плавающий" миниатюрный вид обложки, позиционируется поверх `PageCover` и контента.
  - Содержит сложные внутренние и внешние тени (`box-shadow: inset...`), backdrop-filter и радиальные градиенты для эффекта глянца и стекла.
- **`MetadataViewer`** (Блок живого предпросмотра):
  - Показывает метаданные (Title, Author, Status, Progress, Tags, Rating) в красивом отформатированном виде.
  - Содержит логику переключения: при клике (`onFocus`) переключается в режим текстового редактирования сырого YAML, при потере фокуса (`onBlur`) сохраняет данные и возвращает красивый UI.

## 2. Дизайн и Токены
Будут использованы существующие токены из `src/styles/tokens/`, а также добавлены новые специфичные токены для страницы книги (в `components.css` или отдельный файл):

### Токены (переменные CSS):
- `--q-book-cover-height`: `164px` (Высота основной обложки страницы).
- `--q-book-margin`: `12px` (Отступы по бокам).
- `--q-book-radius`: `8px`.
- `--q-color-primary`: `#1471EB` (Акцентный синий для кнопки "Читать", тегов и текста).
- `--q-color-text-main`: `rgba(0, 0, 0, 0.90)`.
- `--q-color-text-muted`: `rgba(0, 0, 0, 0.50)`.
- `--q-font-mono`: `IBM Plex Mono` (Шрифт для метаданных).

### Эффекты, Тени и SVG-декорации (UI/UX):
- **Стекломорфизм (Glassmorphism):** Активно используется в `BookCover` (`backdrop-filter: blur(18.28px)`, `background: rgba(255, 255, 255, 0.70)`).
- **Смешивание слоев:** `mix-blend-mode: color-dodge` и `overlay` для создания атмосферных бликов от основной обложки.
- **Тени (Shadows):** 
  - Кнопки: `0px 2px 6px rgba(0, 0, 0, 0.20)`.
  - Книга: Множественные внешние `0px 10px 20px...` и внутренние `inset` тени для придания объема.
- **Встроенные SVG-компоненты (Векторная графика):**
  - **Слой с лучами (Rays):** Сложный SVG с фильтрами `feGaussianBlur` и градиентами (`color-dodge`). Будет вынесен в отдельный React-компонент, привязанный к правому краю `PageCover`.
  - **Звездочка (Star):** SVG с мощным внутренним размытием (`backdrop-filter: blur(18.28px)`) и сложными тенями. Будет позиционироваться абсолютно поверх `BookCover`.
  - **Радиальные градиенты на обложке:** Использование SVG с `mix-blend-mode: overlay` (зеленый к синему) поверх изображения книги, плюс CSS `linear-gradient` с режимом `overlay` прямо на теге `<img>`. Все эти слои будут растянуты на 100% ширины и высоты `BookCover`.

## 3. Адаптивность и Верстка
- **Ширина:** Контейнеры будут использовать `width: 100%` с `padding: 12px`, чтобы обложка гибко растягивалась под любую ширину окна приложения.
- **Позиционирование:** `PageCover` будет находиться в нормальном потоке документа (сверху), а `BookCover` будет спозиционирована абсолютно (`position: absolute; top: ...`) относительно контейнера заголовка, чтобы перекрывать границу между обложкой страницы и текстом.
- **Изображения:** Будет использован `object-fit: cover` для обложки страницы, чтобы она корректно заполняла пространство без искажения пропорций, и `object-fit: contain/cover` для книги в зависимости от соотношения сторон.

## 4. Логика работы (Interaction)
1. **Смена обложек:**
   - При клике на кнопки загрузки будет вызываться нативный диалог выбора файлов.
   - Выбранный файл копируется в папку `Files` в корне базы знаний (если папки нет — она создается с помощью FileSystem API).
   - Путь к файлу сохраняется в метаданные заметки (`cover_url`, `page_cover_url`).
2. **Live Preview Метаданных:**
   - Компонент отслеживает фокус. Если кликнуть в любую область метаданных, блок заменяется на обычный текстовый редактор.
   - Изменения парсятся как YAML и при потере фокуса UI обновляется.

## 5. План реализации по шагам
1. **Шаг 1:** Обновление CSS токенов и базовой разметки компонента редактора. Смещение заголовка вниз.
2. **Шаг 2:** Создание компонента `PageCover` (включая сложные блики из Figma-разметки и кнопку Читать).
3. **Шаг 3:** Создание компонента `BookCover` с тенями и радиальным свечением.
4. **Шаг 4:** Создание компонента `MetadataViewer` со шрифтом IBM Plex Mono, тегами и логикой Focus/Blur.
5. **Шаг 5:** Интеграция логики сохранения файлов в директорию `Files` и обновления Frontmatter.

---

## 6. Исходники SVG-эффектов (Сохранены для реализации)

### Лучи (Rays Layer)
```xml
<svg width="311" height="172" viewBox="0 0 311 172" fill="none" xmlns="http://www.w3.org/2000/svg">
<g style="mix-blend-mode:color-dodge" opacity="0.7" clip-path="url(#clip0_148_2543)">
<g opacity="0.5" style="mix-blend-mode:overlay">
<rect width="311" height="172" fill="url(#paint0_linear_148_2543)"/>
</g>
<g filter="url(#filter0_f_148_2543)">
<path d="M394.487 -2.72283L237.769 -17.5915L189.579 172.329L394.487 -2.72283Z" fill="url(#paint1_linear_148_2543)"/>
</g>
<g filter="url(#filter1_f_148_2543)">
<path d="M298.919 -10.8409L266.071 -58.9714L75.1033 154.613L298.919 -10.8409Z" fill="url(#paint2_linear_148_2543)"/>
</g>
<g filter="url(#filter2_f_148_2543)">
<path d="M285.505 -38.0008L270.508 -87.8554L6.92272 116.597L285.505 -38.0008Z" fill="url(#paint3_linear_148_2543)"/>
</g>
<g filter="url(#filter3_f_148_2543)">
<path d="M353.568 -15.8933L300.139 -17.0238L180.048 167.897L353.568 -15.8933Z" fill="url(#paint4_linear_148_2543)"/>
</g>
<g opacity="0.6" filter="url(#filter4_f_148_2543)">
<path d="M392.156 -30.8343L369.785 -40.6915L290.1 162.258L392.156 -30.8343Z" fill="url(#paint5_linear_148_2543)"/>
</g>
<g opacity="0.6" filter="url(#filter5_f_148_2543)">
<path d="M309.19 -40.8136L294.329 -52.5976L86.597 141.044L309.19 -40.8136Z" fill="url(#paint6_linear_148_2543)"/>
</g>
<g opacity="0.6" filter="url(#filter6_f_148_2543)">
<path d="M306.296 -67.517L295.939 -80.063L23.0478 103.575L306.296 -67.517Z" fill="url(#paint7_linear_148_2543)"/>
</g>
</g>
<defs>
<filter id="filter0_f_148_2543" x="129.579" y="-77.5915" width="324.908" height="309.921" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
<feFlood flood-opacity="0" result="BackgroundImageFix"/>
<feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
<feGaussianBlur stdDeviation="30" result="effect1_foregroundBlur_148_2543"/>
</filter>
<filter id="filter1_f_148_2543" x="35.1033" y="-98.9714" width="303.816" height="293.585" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
<feFlood flood-opacity="0" result="BackgroundImageFix"/>
<feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
<feGaussianBlur stdDeviation="20" result="effect1_foregroundBlur_148_2543"/>
</filter>
<filter id="filter2_f_148_2543" x="-33.0774" y="-127.855" width="358.583" height="284.453" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
<feFlood flood-opacity="0" result="BackgroundImageFix"/>
<feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
<feGaussianBlur stdDeviation="20" result="effect1_foregroundBlur_148_2543"/>
</filter>
<filter id="filter3_f_148_2543" x="142.624" y="-54.4474" width="248.367" height="259.768" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
<feFlood flood-opacity="0" result="BackgroundImageFix"/>
<feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
<feGaussianBlur stdDeviation="18.7118" result="effect1_foregroundBlur_148_2543"/>
</filter>
<filter id="filter4_f_148_2543" x="272.1" y="-58.6915" width="138.056" height="238.949" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
<feFlood flood-opacity="0" result="BackgroundImageFix"/>
<feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
<feGaussianBlur stdDeviation="9" result="effect1_foregroundBlur_148_2543"/>
</filter>
<filter id="filter5_f_148_2543" x="66.5972" y="-72.5976" width="262.593" height="233.642" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
<feFlood flood-opacity="0" result="BackgroundImageFix"/>
<feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
<feGaussianBlur stdDeviation="10" result="effect1_foregroundBlur_148_2543"/>
</filter>
<filter id="filter6_f_148_2543" x="8.04785" y="-95.063" width="313.249" height="213.638" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
<feFlood flood-opacity="0" result="BackgroundImageFix"/>
<feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
<feGaussianBlur stdDeviation="7.5" result="effect1_foregroundBlur_148_2543"/>
</filter>
<linearGradient id="paint0_linear_148_2543" x1="311" y1="86" x2="0" y2="86" gradientUnits="userSpaceOnUse">
<stop stop-color="white"/>
<stop offset="1" stop-color="white" stop-opacity="0"/>
</linearGradient>
<linearGradient id="paint1_linear_148_2543" x1="324.26" y1="-43.5857" x2="355.005" y2="124.505" gradientUnits="userSpaceOnUse">
<stop stop-color="#838383"/>
<stop offset="1" stop-color="#4D4D4D"/>
</linearGradient>
<linearGradient id="paint2_linear_148_2543" x1="316.004" y1="-72.5683" x2="324.036" y2="124.505" gradientUnits="userSpaceOnUse">
<stop stop-color="#838383"/>
<stop offset="1" stop-color="#4D4D4D"/>
</linearGradient>
<linearGradient id="paint3_linear_148_2543" x1="324.323" y1="-98.9882" x2="322.527" y2="99.3919" gradientUnits="userSpaceOnUse">
<stop stop-color="#838383"/>
<stop offset="1" stop-color="#4D4D4D"/>
</linearGradient>
<linearGradient id="paint4_linear_148_2543" x1="314.1" y1="-47.9952" x2="344.811" y2="120.239" gradientUnits="userSpaceOnUse">
<stop stop-color="white"/>
<stop offset="1" stop-color="#8C8C8C"/>
</linearGradient>
<linearGradient id="paint5_linear_148_2543" x1="380.534" y1="-75.661" x2="407.42" y2="125.863" gradientUnits="userSpaceOnUse">
<stop stop-color="white"/>
<stop offset="1" stop-color="#8C8C8C"/>
</linearGradient>
<linearGradient id="paint6_linear_148_2543" x1="327.289" y1="-86.2336" x2="335.162" y2="111.137" gradientUnits="userSpaceOnUse">
<stop stop-color="white"/>
<stop offset="1" stop-color="#8C8C8C"/>
</linearGradient>
<linearGradient id="paint7_linear_148_2543" x1="340.278" y1="-112.117" x2="338.305" y2="86.6069" gradientUnits="userSpaceOnUse">
<stop stop-color="white"/>
<stop offset="1" stop-color="#8C8C8C"/>
</linearGradient>
<clipPath id="clip0_148_2543">
<rect width="311" height="172" fill="white"/>
</clipPath>
</defs>
</svg>
```

### Звездочка (Star Layer)
```xml
<svg width="96" height="63" viewBox="0 0 96 63" fill="none" xmlns="http://www.w3.org/2000/svg">
<foreignObject x="-36.5556" y="-36.5556" width="169.111" height="136.111"><div xmlns="http://www.w3.org/1999/xhtml" style="backdrop-filter:blur(18.28px);clip-path:url(#bgblur_0_148_2537_clip_path);height:100%;width:100%"></div></foreignObject><g filter="url(#filter0_ii_148_2537)" data-figma-bg-blur-radius="36.5556">
<path d="M26.7326 32.142C34.8108 26.881 36.851 0 36.851 0C36.851 0 38.6803 24.7488 46 30C54.5 36.0979 96 38.5621 96 38.5621C96 38.5621 53.7749 39.0195 45.6578 44.4024C37.5407 49.7852 36.851 63 36.851 63C36.851 63 35.1929 49.7069 26.7326 44.4024C18.7456 39.3946 0 38.5621 0 38.5621C0 38.5621 18.8107 37.3012 26.7326 32.142Z" fill="white" fill-opacity="0.7"/>
</g>
<defs>
<filter id="filter0_ii_148_2537" x="-36.5556" y="-36.5556" width="169.111" height="136.111" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
<feFlood flood-opacity="0" result="BackgroundImageFix"/>
<feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
<feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
<feOffset dx="-1.93416" dy="-1.93416"/>
<feGaussianBlur stdDeviation="1.93416"/>
<feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1"/>
<feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.5 0"/>
<feBlend mode="normal" in2="shape" result="effect1_innerShadow_148_2537"/>
<feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
<feOffset dx="1.93416" dy="11"/>
<feGaussianBlur stdDeviation="3.86832"/>
<feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1"/>
<feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.3 0"/>
<feBlend mode="normal" in2="effect1_innerShadow_148_2537" result="effect2_innerShadow_148_2537"/>
</filter>
<clipPath id="bgblur_0_148_2537_clip_path" transform="translate(36.5556 36.5556)"><path d="M26.7326 32.142C34.8108 26.881 36.851 0 36.851 0C36.851 0 38.6803 24.7488 46 30C54.5 36.0979 96 38.5621 96 38.5621C96 38.5621 53.7749 39.0195 45.6578 44.4024C37.5407 49.7852 36.851 63 36.851 63C36.851 63 35.1929 49.7069 26.7326 44.4024C18.7456 39.3946 0 38.5621 0 38.5621C0 38.5621 18.8107 37.3012 26.7326 32.142Z"/>
</clipPath></defs>
</svg>
```

### Радиальный градиент поверх книжки
```xml
<svg width="128" height="164" viewBox="0 0 128 164" fill="none" xmlns="http://www.w3.org/2000/svg">
<g style="mix-blend-mode:overlay" opacity="0.5" clip-path="url(#clip0_148_2540)">
<rect width="128" height="164" fill="white"/>
<rect width="128" height="164" fill="url(#paint0_radial_148_2540)"/>
</g>
<defs>
<radialGradient id="paint0_radial_148_2540" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(64) rotate(90) scale(164 175.423)">
<stop offset="0.0520833" stop-color="#00FF84" stop-opacity="0.33"/>
<stop offset="0.447931" stop-color="#0075FF" stop-opacity="0.38"/>
<stop offset="1" stop-color="white" stop-opacity="0"/>
</radialGradient>
<clipPath id="clip0_148_2540">
<rect width="128" height="164" fill="white"/>
</clipPath>
</defs>
</svg>
```
