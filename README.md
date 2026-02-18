# logistruct

## Запуск локально

```powershell
cd i:\logistruct
python -m http.server 8000
```

Відкрийте в браузері: `http://localhost:8000/`

## Тестові сторінки (локальні лінки)

- Базова сторінка: `http://localhost:8000/`
- Режим тесту фону (без інтро): `http://localhost:8000/?bgTest=1`
- Режим редактора теми: `http://localhost:8000/?themeEditor=1`
- Тема `default`: `http://localhost:8000/?theme=default`
- Тема `light`: `http://localhost:8000/?theme=light`
- Тема `dark`: `http://localhost:8000/?theme=dark`
