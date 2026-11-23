import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'
import App from './App.vue'
import hy from './locales/hy.json'
import ru from './locales/ru.json'
import './style.css'

const language = localStorage.getItem('constitution-language') === 'ru' ? 'ru' : 'hy'
const i18n = createI18n({ legacy: false, locale: language, fallbackLocale: 'hy', messages: { hy, ru } })
createApp(App).use(i18n).mount('#app')
