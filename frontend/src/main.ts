import { createPinia } from 'pinia';
import { createApp } from 'vue';
import { registerSW } from 'virtual:pwa-register';
import { setApiToastHandler } from './api/client';
import App from './App.vue';
import { t } from './i18n';
import { router } from './router';
import { useToastStore } from './stores/toast.store';
import './style.css';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(router);

app.config.errorHandler = (err, _instance, info) => {
  const toast = useToastStore(pinia);
  const message = err instanceof Error ? err.message : String(err);
  toast.error(t('toast.unhandled'), `${message}${info ? ` (${info})` : ''}`);
  console.error(err);
};

setApiToastHandler((title, message) => {
  useToastStore(pinia).error(title, message);
});

window.addEventListener('offline', () => {
  useToastStore(pinia).warning(t('toast.offlineTitle'), t('toast.offlineBody'));
});
window.addEventListener('online', () => {
  useToastStore(pinia).success(t('toast.onlineTitle'), t('toast.onlineBody'));
});

registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    // Periodic update check — POS terminals stay open for long shifts.
    if (registration) {
      setInterval(() => {
        void registration.update();
      }, 60 * 60 * 1000);
    }
  },
});

app.mount('#app');
