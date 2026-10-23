import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const SEED = 20261023;
export const CORPUS_SIZE = 180;

export const QUESTION_KINDS = [
  'exact',
  'ru',
  'en',
  'paraphrase',
  'synthesis',
  'graph',
  'duplicate',
  'contradiction',
  'stale',
  'large',
  'empty',
];

const FOLDERS = ['Kubernetes', 'Jenkins', 'Ingress', 'TLS', 'Databases', 'Проекты', 'Архив'];

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function frontmatter({ type, status, tags, updated }) {
  return [
    '---',
    `type: ${type}`,
    `status: ${status}`,
    `tags: [${tags.join(', ')}]`,
    `updated: ${updated}`,
    '---',
  ].join('\n');
}

function composeNote(meta, body) {
  return `${frontmatter(meta)}\n${body.trim()}\n`;
}

function largeBody({ title, lead, marker, seed }) {
  const random = mulberry32(seed);
  const verbs = ['Проверяем', 'Фиксируем', 'Сверяем', 'Описываем', 'Уточняем', 'Считаем'];
  const nouns = ['состояние', 'регламент', 'метрику', 'исключение', 'порядок', 'границу'];
  const lines = [`# ${title}`, '', lead, ''];
  for (let index = 1; index <= 170; index += 1) {
    if (index === 120) {
      lines.push(marker, '');
    }
    const verb = verbs[Math.floor(random() * verbs.length)];
    const noun = nouns[Math.floor(random() * nouns.length)];
    lines.push(
      `## Раздел ${index}`,
      '',
      `${verb} ${noun} для узла ${index}: значение ${(random() * 1000).toFixed(1)}, ` +
        `порог ${Math.floor(random() * 90) + 10}, ответственный ${index % 7}.`,
      '',
    );
  }
  return lines.join('\n');
}

const ANCHORS = [
  {
    path: 'Kubernetes/Обзор Kubernetes.md',
    meta: { type: 'hub', status: 'active', tags: ['k8s', 'обзор'], updated: '2026-03-01' },
    body: `# Обзор Kubernetes

Кластер работает на Kubernetes 1.30.2 и состоит из трёх control-plane узлов.
Рабочие узлы разложены по зонам, карта узлов — в [[Большая карта кластера]].
Основные темы: [[cert-manager]], [[Обновление кластера]], [[Откат деплоя]], [[Ресурсы и лимиты]], [[Поды в CrashLoopBackOff]], [[Horizontal Pod Autoscaler]], [[Секреты и ConfigMap]], [[Сетевые политики]], [[Мониторинг Prometheus]], [[Настройка ingress-nginx]].
Сертификаты описаны в [[Обзор TLS]].
- [ ] проверить квоты namespace`,
  },
  {
    path: 'Kubernetes/cert-manager.md',
    meta: { type: 'note', status: 'active', tags: ['k8s', 'tls'], updated: '2026-02-10' },
    body: `# cert-manager

В кластере установлен cert-manager 1.14.2, обновлён 2026-02-10.
ClusterIssuer letsencrypt-prod выдаёт сертификаты для ingress.
Связанные заметки: [[Выпуск сертификатов Let's Encrypt]], [[TLS termination]], [[Ротация ключей]].
- [x] проверить срок действия`,
  },
  {
    path: 'Kubernetes/Установка cert-manager (старое).md',
    meta: { type: 'note', status: 'archive', tags: ['k8s', 'tls', 'архив'], updated: '2023-04-12' },
    body: `# Установка cert-manager (старое)

В 2023 году ставили cert-manager 1.12.0 через helm.
Инструкция устарела, актуальная версия в [[cert-manager]].
- [x] архив`,
  },
  {
    path: 'Kubernetes/Обновление кластера.md',
    meta: { type: 'note', status: 'active', tags: ['k8s', 'операции'], updated: '2026-01-18' },
    body: `# Обновление кластера

Порядок обновления: сначала control-plane, потом workers.
Основная команда: kubeadm upgrade apply v1.30.2.
Перед обновлением читайте [[Ресурсы и лимиты]].
- [ ] снять etcd snapshot`,
  },
  {
    path: 'Kubernetes/Откат деплоя.md',
    meta: { type: 'note', status: 'active', tags: ['k8s', 'деплой'], updated: '2026-01-22' },
    body: `# Откат деплоя

Быстрый откат: kubectl rollout undo deployment/api.
Так можно вернуть предыдущую версию приложения за несколько секунд.
История ревизий: kubectl rollout history deployment/api.
- [ ] проверить статус после отката`,
  },
  {
    path: 'Kubernetes/Ресурсы и лимиты.md',
    meta: { type: 'note', status: 'active', tags: ['k8s', 'ресурсы'], updated: '2025-11-30' },
    body: `# Ресурсы и лимиты

Чтобы ограничить потребление памяти контейнером, задайте limits.memory.
Пример: requests: cpu 250m, memory 256Mi.
Лимиты обсуждаются в [[Обзор Kubernetes]].
- [ ] пересмотреть квоты`,
  },
  {
    path: 'Kubernetes/Большая карта кластера.md',
    meta: { type: 'note', status: 'active', tags: ['k8s', 'карта'], updated: '2026-02-02' },
    body: largeBody({
      title: 'Большая карта кластера',
      lead: 'Полная карта узлов, зон и рабочих нагрузок продакшен-кластера.',
      marker: 'Узел worker-17 находится в зоне eu-west-1c и обслуживает batch-нагрузку.',
      seed: 1701,
    }),
  },
  {
    path: 'Kubernetes/Orphan-заметка про Helm.md',
    meta: { type: 'note', status: 'active', tags: ['k8s', 'helm'], updated: '2025-09-09' },
    body: `# Orphan-заметка про Helm

Эта заметка ни с чем не связана.
Установка релиза: helm upgrade --atomic --timeout 10m.
- [ ] добавить ссылки`,
  },
  {
    path: 'Kubernetes/Namespace policy.md',
    meta: { type: 'note', status: 'draft', tags: ['k8s', 'политика'], updated: '2025-10-04' },
    body: `# Namespace policy

Политика namespace требует, чтобы cert-manager жил в отдельном пространстве имён.
Черновик политики лежит в [[Политика сети (черновик)]].
- [ ] согласовать с командой`,
  },
  {
    path: 'Kubernetes/Настройка ingress-nginx.md',
    meta: { type: 'note', status: 'active', tags: ['k8s', 'ingress'], updated: '2026-01-05' },
    body: `# Настройка ingress-nginx

Контроллер ingress-nginx слушает service port 8443.
Установка через helm, значения лежат в git.
См. [[Обзор Ingress]] и [[Маршрутизация по путям]].
- [ ] проверить сертификат`,
  },
  {
    path: 'Kubernetes/Поды в CrashLoopBackOff.md',
    meta: { type: 'note', status: 'active', tags: ['k8s', 'диагностика'], updated: '2025-12-14' },
    body: `# Поды в CrashLoopBackOff

Если поды падают в CrashLoopBackOff, смотрите kubectl logs --previous.
Частая причина — неверный ConfigMap.
- [ ] собрать диагностику`,
  },
  {
    path: 'Kubernetes/Horizontal Pod Autoscaler.md',
    meta: { type: 'note', status: 'active', tags: ['k8s', 'масштабирование'], updated: '2025-08-21' },
    body: `# Horizontal Pod Autoscaler

Horizontal Pod Autoscaler масштабирует поды по CPU.
Минимум две реплики, максимум десять.
- [ ] настроить метрики`,
  },
  {
    path: 'Kubernetes/Секреты и ConfigMap.md',
    meta: { type: 'note', status: 'active', tags: ['k8s', 'безопасность'], updated: '2026-01-11' },
    body: `# Секреты и ConfigMap

Секреты хранятся в Secret, конфигурация — в ConfigMap.
Не кладите пароли в открытый ConfigMap.
- [ ] проверить права`,
  },
  {
    path: 'Kubernetes/Сетевые политики.md',
    meta: { type: 'note', status: 'active', tags: ['k8s', 'сеть'], updated: '2025-07-03' },
    body: `# Сетевые политики

NetworkPolicy ограничивает трафик между namespace.
Разрешайте только нужные порты.
- [ ] нарисовать схему`,
  },
  {
    path: 'Kubernetes/Мониторинг Prometheus.md',
    meta: { type: 'note', status: 'active', tags: ['k8s', 'мониторинг'], updated: '2026-02-19' },
    body: `# Мониторинг Prometheus

Prometheus собирает метрики с kubelet и приложений.
Алерты уходят в Alertmanager.
- [ ] проверить retention`,
  },
  {
    path: 'Kubernetes/Версия кластера.md',
    meta: { type: 'note', status: 'active', tags: ['k8s', 'версии'], updated: '2026-03-02' },
    body: `# Версия кластера

В продакшене развёрнут Kubernetes 1.30.2.
Обновление описано в [[Обновление кластера]].
- [x] сверено с kubeadm`,
  },
  {
    path: 'Jenkins/Обзор Jenkins.md',
    meta: { type: 'hub', status: 'active', tags: ['jenkins', 'обзор'], updated: '2026-02-27' },
    body: `# Обзор Jenkins

Jenkins собирает и выкладывает приложения.
Основные заметки: [[Пайплайн деплоя]], [[Сборка Docker-образа]], [[Агенты и метки]], [[Плагины]], [[Резервное копирование Jenkins]], [[Параллельные стадии]], [[Уведомления в Telegram]].
- [ ] обновить плагины`,
  },
  {
    path: 'Jenkins/Пайплайн деплоя.md',
    meta: { type: 'note', status: 'active', tags: ['jenkins', 'деплой'], updated: '2026-02-15' },
    body: `# Пайплайн деплоя

Пайплайн деплоя собирает образ и запускает выкладку.
Связь с маршрутизацией описана в [[Мост Jenkins и Ingress]].
- [ ] добавить smoke-тест`,
  },
  {
    path: 'Jenkins/Сборка Docker-образа.md',
    meta: { type: 'note', status: 'active', tags: ['jenkins', 'docker'], updated: '2026-01-27' },
    body: `# Сборка Docker-образа

Образ собирается командой docker build --pull --no-cache.
Тег включает короткий git sha.
- [ ] ускорить слой зависимостей`,
  },
  {
    path: 'Jenkins/Агенты и метки.md',
    meta: { type: 'note', status: 'active', tags: ['jenkins', 'агенты'], updated: '2025-12-08' },
    body: `# Агенты и метки

Настройка агентов Jenkins требует Java 11 на всех исполнителях.
Метки разделяют агентов по назначению.
- [ ] обновить метки`,
  },
  {
    path: 'Jenkins/Агенты на Java 17.md',
    meta: { type: 'note', status: 'active', tags: ['jenkins', 'агенты'], updated: '2026-02-20' },
    body: `# Агенты на Java 17

Новые агенты Jenkins работают на Java 17.
Старые исполнители ещё не переведены.
- [ ] перевести оставшиеся`,
  },
  {
    path: 'Jenkins/Плагины.md',
    meta: { type: 'note', status: 'active', tags: ['jenkins', 'плагины'], updated: '2025-11-11' },
    body: `# Плагины

Список плагинов фиксируется в jenkins/plugins.txt.
Обновлять по одной штуке.
- [ ] проверить совместимость`,
  },
  {
    path: 'Jenkins/Резервное копирование Jenkins.md',
    meta: { type: 'note', status: 'active', tags: ['jenkins', 'бэкап'], updated: '2025-10-16' },
    body: `# Резервное копирование Jenkins

JENKINS_HOME копируется целиком раз в сутки.
Проверка восстановления раз в месяц.
- [ ] проверить архив`,
  },
  {
    path: 'Jenkins/Orphan-заметка про Groovy.md',
    meta: { type: 'note', status: 'draft', tags: ['jenkins', 'groovy'], updated: '2025-06-06' },
    body: `# Orphan-заметка про Groovy

Заметка про Groovy-скрипты ни с чем не связана.
Пример: sh 'echo hello'.
- [ ] удалить или связать`,
  },
  {
    path: 'Jenkins/Параллельные стадии.md',
    meta: { type: 'note', status: 'active', tags: ['jenkins', 'сборка'], updated: '2026-01-30' },
    body: `# Параллельные стадии

Jenkins parallel stages ускоряют сборку за счёт параллельных шагов.
Пример: parallel { stage('unit') { ... } }.
- [ ] разнести тесты`,
  },
  {
    path: 'Jenkins/Уведомления в Telegram.md',
    meta: { type: 'note', status: 'active', tags: ['jenkins', 'уведомления'], updated: '2025-09-25' },
    body: `# Уведомления в Telegram

Плагин отправляет статус сборки в Telegram.
Токен лежит в credentials.
- [ ] проверить формат`,
  },
  {
    path: 'Ingress/Обзор Ingress.md',
    meta: { type: 'hub', status: 'active', tags: ['ingress', 'обзор'], updated: '2026-02-24' },
    body: `# Обзор Ingress

Ingress описывает внешний доступ к сервисам.
Смотрите [[Маршрутизация по путям]], [[TLS termination]], [[Ingress для деплоя]], [[Аннотации ingress-nginx]], [[Балансировка нагрузки]], [[Ошибка 502]].
- [ ] проверить хосты`,
  },
  {
    path: 'Ingress/Маршрутизация по путям.md',
    meta: { type: 'note', status: 'active', tags: ['ingress', 'маршрутизация'], updated: '2026-01-14' },
    body: `# Маршрутизация по путям

Для путей используется pathType: Prefix.
Точные пути описываются отдельным правилом.
- [ ] проверить конфликт путей`,
  },
  {
    path: 'Ingress/TLS termination.md',
    meta: { type: 'note', status: 'active', tags: ['ingress', 'tls'], updated: '2026-02-06' },
    body: `# TLS termination

TLS завершается на ingress-контроллере.
Сертификат выдаёт [[cert-manager]].
- [ ] проверить цепочку`,
  },
  {
    path: 'Ingress/Ingress для деплоя.md',
    meta: { type: 'note', status: 'active', tags: ['ingress', 'деплой'], updated: '2026-02-12' },
    body: `# Ingress для деплоя

Маршрут для выкладки приложения описан в этом манифесте.
Обратно к [[Мост Jenkins и Ingress]].
- [ ] проверить host`,
  },
  {
    path: 'Ingress/Аннотации ingress-nginx.md',
    meta: { type: 'note', status: 'active', tags: ['ingress', 'nginx'], updated: '2025-12-19' },
    body: `# Аннотации ingress-nginx

Таймаут чтения задаётся аннотацией proxy-read-timeout: 60.
Этого хватает для коротких запросов.
- [ ] сверить с нагрузкой`,
  },
  {
    path: 'Ingress/Аннотации nginx (новые).md',
    meta: { type: 'note', status: 'active', tags: ['ingress', 'nginx'], updated: '2026-02-21' },
    body: `# Аннотации nginx (новые)

После инцидента таймаут подняли: proxy-read-timeout: 300.
Значение действует для всех маршрутов.
- [ ] закрепить в git`,
  },
  {
    path: 'Ingress/Orphan-заметка про rewrite.md',
    meta: { type: 'note', status: 'draft', tags: ['ingress', 'nginx'], updated: '2025-05-17' },
    body: `# Orphan-заметка про rewrite

Заметка про rewrite-target ни с чем не связана.
Пример: nginx.ingress.kubernetes.io/rewrite-target: /.
- [ ] связать с обзором`,
  },
  {
    path: 'Ingress/Балансировка нагрузки.md',
    meta: { type: 'note', status: 'active', tags: ['ingress', 'сеть'], updated: '2025-10-29' },
    body: `# Балансировка нагрузки

Ingress распределяет запросы между подами сервиса.
Балансировка выполняется на уровне контроллера.
- [ ] проверить endpoints`,
  },
  {
    path: 'Ingress/Ошибка 502.md',
    meta: { type: 'note', status: 'active', tags: ['ingress', 'диагностика'], updated: '2026-01-08' },
    body: `# Ошибка 502

Ошибка 502 bad gateway чаще всего означает, что под не готов.
Проверьте readiness probe и endpoints.
- [ ] добавить алерт`,
  },
  {
    path: 'TLS/Обзор TLS.md',
    meta: { type: 'hub', status: 'active', tags: ['tls', 'обзор'], updated: '2026-02-25' },
    body: `# Обзор TLS

TLS настраивается для всех внешних хостов.
Основные заметки: [[Выпуск сертификатов Let's Encrypt]], [[Проверка цепочки сертификатов]], [[Ротация ключей]], [[Самоподписанные сертификаты]], [[Протоколы и шифры]], [[Ошибка x509 certificate has expired]].
- [ ] проверить сроки`,
  },
  {
    path: "TLS/Выпуск сертификатов Let's Encrypt.md",
    meta: { type: 'note', status: 'active', tags: ['tls', 'letsencrypt'], updated: '2026-01-19' },
    body: `# Выпуск сертификатов Let's Encrypt

Выпуск идёт через webroot /var/www/letsencrypt.
Продление выполняет cron.
- [ ] проверить cron`,
  },
  {
    path: 'TLS/Проверка цепочки сертификатов.md',
    meta: { type: 'note', status: 'active', tags: ['tls', 'диагностика'], updated: '2025-12-03' },
    body: `# Проверка цепочки сертификатов

Цепочку проверяем командой openssl s_client -connect example.com:443.
Смотрите поле Verify return code.
- [ ] добавить в runbook`,
  },
  {
    path: 'TLS/Ротация ключей.md',
    meta: { type: 'note', status: 'active', tags: ['tls', 'ключи'], updated: '2026-02-08' },
    body: `# Ротация ключей

Ротация ключей позволяет продлить срок действия сертификата без простоя.
cert-manager делает это автоматически.
- [ ] проверить расписание`,
  },
  {
    path: 'TLS/Самоподписанные сертификаты.md',
    meta: { type: 'note', status: 'active', tags: ['tls', 'стенды'], updated: '2025-08-14' },
    body: `# Самоподписанные сертификаты

Для тестовых стендов используем самоподписанные сертификаты.
Не ставьте их в продакшен.
- [ ] удалить старые`,
  },
  {
    path: 'TLS/Orphan-заметка про OCSP.md',
    meta: { type: 'note', status: 'draft', tags: ['tls', 'ocsp'], updated: '2025-04-01' },
    body: `# Orphan-заметка про OCSP

Заметка про OCSP stapling ни с чем не связана.
Черновик: [[OCSP stapling настройка]].
- [ ] решить судьбу`,
  },
  {
    path: 'TLS/Протоколы и шифры.md',
    meta: { type: 'note', status: 'active', tags: ['tls', 'безопасность'], updated: '2026-01-23' },
    body: `# Протоколы и шифры

Разрешены TLS 1.2 и TLS 1.3.
Слабые шифры отключены.
- [ ] пересмотреть список`,
  },
  {
    path: 'TLS/Ошибка x509 certificate has expired.md',
    meta: { type: 'note', status: 'active', tags: ['tls', 'диагностика'], updated: '2026-02-01' },
    body: `# Ошибка x509 certificate has expired

Ошибка x509 certificate has expired означает истёкший сертификат.
Проверьте даты и цепочку.
- [ ] настроить алерт`,
  },
  {
    path: 'Databases/Обзор баз данных.md',
    meta: { type: 'hub', status: 'active', tags: ['базы', 'обзор'], updated: '2026-02-26' },
    body: `# Обзор баз данных

В продакшене PostgreSQL и Redis.
Основные заметки: [[PostgreSQL]], [[Резервное копирование PostgreSQL]], [[Индексы и планы запросов]], [[Репликация]], [[Redis]].
- [ ] проверить версии`,
  },
  {
    path: 'Databases/PostgreSQL.md',
    meta: { type: 'note', status: 'active', tags: ['базы', 'postgres'], updated: '2026-02-18' },
    body: `# PostgreSQL

В продакшене используется PostgreSQL 16.
Версия закреплена в docker-compose.
- [ ] проверить расширения`,
  },
  {
    path: 'Databases/PostgreSQL 14 (старое).md',
    meta: { type: 'note', status: 'archive', tags: ['базы', 'postgres', 'архив'], updated: '2023-06-15' },
    body: `# PostgreSQL 14 (старое)

На старом стенде стоял PostgreSQL 14.
Стенд выведен из эксплуатации.
- [x] архив`,
  },
  {
    path: 'Databases/Резервное копирование PostgreSQL.md',
    meta: { type: 'note', status: 'active', tags: ['базы', 'бэкап'], updated: '2026-01-29' },
    body: `# Резервное копирование PostgreSQL

Бэкап снимается командой pg_dump -Fc --compress=9.
Файлы складываются в object storage.
- [ ] проверить восстановление`,
  },
  {
    path: 'Databases/Огромный справочник SQL.md',
    meta: { type: 'note', status: 'active', tags: ['базы', 'sql'], updated: '2026-02-04' },
    body: largeBody({
      title: 'Огромный справочник SQL',
      lead: 'Справочник по запросам, планам и настройкам PostgreSQL.',
      marker: 'Самый медленный JOIN на таблице orders выполнялся 42 секунды.',
      seed: 4201,
    }),
  },
  {
    path: 'Databases/Индексы и планы запросов.md',
    meta: { type: 'note', status: 'active', tags: ['базы', 'sql'], updated: '2026-01-12' },
    body: `# Индексы и планы запросов

Медленные запросы ищутся через pg_stat_statements.
План смотрите через EXPLAIN ANALYZE.
- [ ] собрать топ-20`,
  },
  {
    path: 'Databases/Репликация.md',
    meta: { type: 'note', status: 'active', tags: ['базы', 'postgres'], updated: '2025-12-22' },
    body: `# Репликация

postgres replication lag контролируется метрикой.
Отставание больше минуты — повод для алерта.
- [ ] проверить слоты`,
  },
  {
    path: 'Databases/Redis.md',
    meta: { type: 'note', status: 'active', tags: ['базы', 'redis'], updated: '2025-11-19' },
    body: `# Redis

redis persistence настроен через AOF.
Снимки RDB оставлены как резерв.
- [ ] проверить fsync`,
  },
  {
    path: 'Databases/Orphan-заметка про SQLite.md',
    meta: { type: 'note', status: 'draft', tags: ['базы', 'sqlite'], updated: '2025-03-28' },
    body: `# Orphan-заметка про SQLite

Заметка про SQLite ни с чем не связана.
Пример: sqlite3 notes.db.
- [ ] связать с обзором`,
  },
  {
    path: 'Проекты/Обзор проектов.md',
    meta: { type: 'hub', status: 'active', tags: ['проекты', 'обзор'], updated: '2026-03-03' },
    body: `# Обзор проектов

Список активных проектов и их состояние.
Смотрите [[Миграция на Kubernetes]], [[Мост Jenkins и Ingress]], [[Спринт 42]], [[Ретроспектива]], [[Проект Атлас]], [[Проект Вектор]], [[Риски]].
- [ ] обновить статусы`,
  },
  {
    path: 'Проекты/Миграция на Kubernetes.md',
    meta: { type: 'note', status: 'active', tags: ['проекты', 'k8s'], updated: '2026-02-13' },
    body: `# Миграция на Kubernetes

В рамках миграции перенесли 42 сервиса.
Осталось перенести batch-задачи.
- [ ] закрыть хвост`,
  },
  {
    path: 'Проекты/Мост Jenkins и Ingress.md',
    meta: { type: 'note', status: 'active', tags: ['проекты', 'jenkins', 'ingress'], updated: '2026-02-16' },
    body: `# Мост Jenkins и Ingress

Заметка соединяет пайплайн деплоя и маршрутизацию.
Ссылки: [[Пайплайн деплоя]], [[Ingress для деплоя]].
- [ ] описать схему`,
  },
  {
    path: 'Проекты/Спринт 42.md',
    meta: { type: 'note', status: 'active', tags: ['проекты', 'спринт'], updated: '2026-02-28' },
    body: `# Спринт 42

Цели спринта:
- [ ] закрыть миграцию
- [ ] обновить runbook
- [x] согласовать бюджет`,
  },
  {
    path: 'Проекты/Ретроспектива.md',
    meta: { type: 'note', status: 'active', tags: ['проекты', 'ретро'], updated: '2026-01-31' },
    body: `# Ретроспектива

Что прошло хорошо: релизы стали чаще.
Что улучшить: меньше ручных шагов.
- [ ] завести задачи`,
  },
  {
    path: 'Проекты/Orphan-заметка про бюджет.md',
    meta: { type: 'note', status: 'draft', tags: ['проекты', 'бюджет'], updated: '2025-07-21' },
    body: `# Orphan-заметка про бюджет

Заметка про бюджет ни с чем не связана.
- [ ] связать с проектами`,
  },
  {
    path: 'Проекты/Проект Атлас.md',
    meta: { type: 'note', status: 'active', tags: ['проекты', 'атлас'], updated: '2025-12-11' },
    body: `# Проект Атлас

Проект Атлас — внутренний каталог сервисов.
Связан с [[Обзор проектов]].
- [ ] обновить карту`,
  },
  {
    path: 'Проекты/Проект Вектор.md',
    meta: { type: 'note', status: 'active', tags: ['проекты', 'вектор'], updated: '2026-01-06' },
    body: `# Проект Вектор

Проект Вектор — переезд аналитики.
Связан с [[Обзор проектов]].
- [ ] согласовать схему`,
  },
  {
    path: 'Проекты/Риски.md',
    meta: { type: 'note', status: 'active', tags: ['проекты', 'риски'], updated: '2026-02-09' },
    body: `# Риски

Главный риск — нехватка людей.
Второй риск — устаревшие агенты Jenkins.
- [ ] пересмотреть раз в месяц`,
  },
  {
    path: 'Архив/Большой разбор инцидента.md',
    meta: { type: 'note', status: 'archive', tags: ['архив', 'инцидент'], updated: '2024-03-20' },
    body: largeBody({
      title: 'Большой разбор инцидента',
      lead: 'Хронология, причины и выводы по инциденту с очередью.',
      marker: 'Инцидент 2024-03-14: очередь RabbitMQ переполнилась из-за зависшего обработчика.',
      seed: 9142,
    }),
  },
  {
    path: 'Архив/Старые ссылки.md',
    meta: { type: 'note', status: 'archive', tags: ['архив', 'ссылки'], updated: '2023-09-02' },
    body: `# Старые ссылки

Старый runbook: [[Удалённая заметка про Jenkins]].
- [x] архив`,
  },
  {
    path: 'Архив/Заметки 2023.md',
    meta: { type: 'note', status: 'archive', tags: ['архив', 'сводка'], updated: '2023-12-31' },
    body: `# Заметки 2023

Сводка старых решений за 2023 год.
План миграции: [[Старый план миграции]].
Часть заметок перенесена в проекты.
- [x] архив`,
  },
  {
    path: 'Архив/Orphan-заметка про FTP.md',
    meta: { type: 'note', status: 'archive', tags: ['архив', 'ftp'], updated: '2022-11-05' },
    body: `# Orphan-заметка про FTP

Заметка про FTP ни с чем не связана.
- [ ] удалить`,
  },
  {
    path: 'Архив/Версия кластера (2023).md',
    meta: { type: 'note', status: 'archive', tags: ['архив', 'k8s'], updated: '2023-08-17' },
    body: `# Версия кластера (2023)

В 2023 году кластер работал на Kubernetes 1.27.4.
Позже обновились до новой версии.
- [x] архив`,
  },
];

const DUPLICATES = [
  {
    source: 'Kubernetes/Настройка ingress-nginx.md',
    target: 'Архив/Настройка ingress-nginx (копия).md',
    from: 'service port 8443',
    to: 'service port 8080',
    tags: ['k8s', 'ingress', 'архив'],
    updated: '2023-05-11',
  },
  {
    source: "TLS/Выпуск сертификатов Let's Encrypt.md",
    target: "Архив/Выпуск сертификатов Let's Encrypt (старое).md",
    from: '/var/www/letsencrypt',
    to: '/srv/acme',
    tags: ['tls', 'letsencrypt', 'архив'],
    updated: '2023-02-14',
  },
  {
    source: 'Jenkins/Сборка Docker-образа.md',
    target: 'Архив/Сборка Docker-образа (черновик).md',
    from: 'docker build --pull --no-cache',
    to: 'docker build --no-cache',
    tags: ['jenkins', 'docker', 'архив'],
    updated: '2023-03-09',
  },
  {
    source: 'Databases/Резервное копирование PostgreSQL.md',
    target: 'Архив/Резервное копирование PostgreSQL (v1).md',
    from: 'pg_dump -Fc --compress=9',
    to: 'pg_dump -Fc',
    tags: ['базы', 'бэкап', 'архив'],
    updated: '2023-01-27',
  },
  {
    source: 'Ingress/Маршрутизация по путям.md',
    target: 'Архив/Маршрутизация по путям (копия).md',
    from: 'pathType: Prefix',
    to: 'pathType: ImplementationSpecific',
    tags: ['ingress', 'маршрутизация', 'архив'],
    updated: '2023-07-04',
  },
  {
    source: 'Проекты/Миграция на Kubernetes.md',
    target: 'Архив/Миграция на Kubernetes (старое).md',
    from: 'перенесли 42 сервиса',
    to: 'перенесли 37 сервисов',
    tags: ['проекты', 'k8s', 'архив'],
    updated: '2023-10-22',
  },
];

const CONTRADICTIONS = [
  { topic: 'cert-manager', paths: ['Kubernetes/cert-manager.md', 'Kubernetes/Установка cert-manager (старое).md'] },
  { topic: 'java', paths: ['Jenkins/Агенты и метки.md', 'Jenkins/Агенты на Java 17.md'] },
  { topic: 'postgresql', paths: ['Databases/PostgreSQL.md', 'Databases/PostgreSQL 14 (старое).md'] },
  { topic: 'ingress-timeout', paths: ['Ingress/Аннотации ingress-nginx.md', 'Ingress/Аннотации nginx (новые).md'] },
  { topic: 'kubernetes', paths: ['Kubernetes/Версия кластера.md', 'Архив/Версия кластера (2023).md'] },
];

const FILLER_TOPICS = {
  Kubernetes: [
    'Практика кластера',
    'Разбор манифеста',
    'Квоты namespace',
    'Политики обновления',
    'Логи контейнеров',
    'Readiness probe',
    'Init-контейнеры',
    'Taints и tolerations',
    'StorageClass',
    'Ingress контроллер',
    'Service mesh',
    'Node affinity',
    'Pod disruption budget',
    'Metrics server',
    'Kubelet',
    'RuntimeClass',
    'CRD',
    'Finalizers',
  ],
  Jenkins: [
    'Практика Jenkins',
    'Declarative pipeline',
    'Shared library',
    'Кэш зависимостей',
    'Этапы сборки',
    'Параметры сборки',
    'Credentials',
    'Ноды и исполнители',
    'Триггеры',
    'Артефакты',
    'Отчёты тестов',
    'Таймауты',
    'Логи сборки',
    'Миграция Jenkins',
  ],
  Ingress: [
    'Практика Ingress',
    'Хосты и пути',
    'Rewrite правила',
    'Websocket',
    'Таймауты',
    'Коды ответов',
    'Аннотации',
    'IngressClass',
    'Canary',
    'Логи контроллера',
    'Пулы upstream',
    'Проверки здоровья',
  ],
  TLS: [
    'Практика TLS',
    'Цепочка доверия',
    'Промежуточные сертификаты',
    'SNI',
    'HSTS',
    'Шифры',
    'Клиентские сертификаты',
    'Проверка домена',
    'Автопродление',
    'Хранилище ключей',
    'Аудит сертификатов',
    'Отзыв сертификатов',
  ],
  Databases: [
    'Практика PostgreSQL',
    'Вакуум и анализ',
    'Блокировки',
    'Партиционирование',
    'Транзакции',
    'Миграции схемы',
    'Пул соединений',
    'Статистика',
    'Расширения',
    'Роли и права',
    'Мониторинг базы',
    'Резервные копии',
    'Восстановление',
    'Кластер базы',
    'Настройки памяти',
    'Размер таблиц',
  ],
  Проекты: [
    'Практика проектов',
    'Планирование релиза',
    'Согласование задач',
    'Оценка сроков',
    'Дорожная карта',
    'Статус проекта',
    'Команда проекта',
    'Метрики проекта',
    'Встречи и решения',
    'Зависимости',
    'Ручные шаги',
    'Автоматизация',
    'Документация',
    'Приёмка',
    'Поддержка',
    'Обучение',
    'Доступы',
    'Инциденты проекта',
    'Бюджет проекта',
    'Итоги квартала',
  ],
  Архив: [
    'Архивная заметка',
    'Старый регламент',
    'Старый стенд',
    'Старый runbook',
    'Старая схема',
    'Старый отчёт',
    'Старый план',
    'Старый чек-лист',
    'Старая инструкция',
    'Старый разбор',
    'Старый мониторинг',
    'Старая миграция',
    'Старый деплой',
    'Старый сертификат',
    'Старый кластер',
    'Старый проект',
  ],
};

const UNLINKED_MENTIONS = [
  { index: 3, title: 'TLS termination' },
  { index: 17, title: 'cert-manager' },
  { index: 29, title: 'Пайплайн деплоя' },
  { index: 41, title: 'Резервное копирование PostgreSQL' },
  { index: 55, title: 'Обзор Ingress' },
  { index: 68, title: 'Ротация ключей' },
  { index: 81, title: 'Мониторинг Prometheus' },
  { index: 94, title: 'Маршрутизация по путям' },
];

const FILLER_ORPHANS = new Set([7, 23, 41, 67, 89, 103]);

const FILLER_TAGS = {
  Kubernetes: ['k8s', 'практика'],
  Jenkins: ['jenkins', 'практика'],
  Ingress: ['ingress', 'практика'],
  TLS: ['tls', 'практика'],
  Databases: ['базы', 'практика'],
  Проекты: ['проекты', 'практика'],
  Архив: ['архив', 'практика'],
};

const HUBS = {
  Kubernetes: 'Обзор Kubernetes',
  Jenkins: 'Обзор Jenkins',
  Ingress: 'Обзор Ingress',
  TLS: 'Обзор TLS',
  Databases: 'Обзор баз данных',
  Проекты: 'Обзор проектов',
  Архив: 'Заметки 2023',
};

function titleOf(relPath) {
  return path.basename(relPath, '.md');
}

function folderOf(relPath) {
  return relPath.split('/')[0];
}

function writeNote(vault, relPath, content) {
  const full = path.join(vault, relPath);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
  return full;
}

function readBody(relPath, vault) {
  const raw = readFileSync(path.join(vault, relPath), 'utf8');
  const parts = raw.split('\n---\n');
  return parts.length > 1 ? parts.slice(1).join('\n---\n') : raw;
}

function overlapRatio(sourceLines, duplicateLines) {
  const counts = new Map();
  for (const line of sourceLines) {
    counts.set(line, (counts.get(line) || 0) + 1);
  }
  let identical = 0;
  for (const line of duplicateLines) {
    const count = counts.get(line) || 0;
    if (count > 0) {
      identical += 1;
      counts.set(line, count - 1);
    }
  }
  return identical / Math.max(sourceLines.length, duplicateLines.length);
}

function buildDuplicate(vault, spec, index) {
  const source = readFileSync(path.join(vault, spec.source), 'utf8');
  const body = readBody(spec.source, vault);
  const lines = body.replace(/\n$/, '').split('\n');
  const changed = lines.map((line) => (line.includes(spec.from) ? line.replace(spec.from, spec.to) : line));
  if (!changed.some((line, position) => line !== lines[position])) {
    throw new Error(`duplicate ${spec.target}: phrase not found: ${spec.from}`);
  }
  const archiveLines = [
    '',
    `Архивная копия заметки «${titleOf(spec.source)}», сохранена ${spec.updated}.`,
    'Актуальную версию ищите в рабочем разделе.',
  ];
  let extra = 0;
  const ratioWith = (count) => (lines.length - 1) / (lines.length + count);
  while (ratioWith(extra) > 0.9) extra += 1;
  while (extra > 0 && ratioWith(extra) < 0.8) extra -= 1;
  const duplicateLines = changed.concat(archiveLines.slice(0, extra));
  const overlap = overlapRatio(lines, duplicateLines);
  const content = composeNote(
    { type: 'note', status: 'archive', tags: spec.tags, updated: spec.updated },
    duplicateLines.join('\n'),
  );
  writeNote(vault, spec.target, content);
  return {
    source: spec.source,
    target: spec.target,
    overlap: Number(overlap.toFixed(3)),
    changed: spec.from,
    replacement: spec.to,
    index,
  };
}

function buildFiller(folder, title, index, random) {
  const tasks = index % 3 === 0;
  const linksHub = !FILLER_ORPHANS.has(index);
  const unlinked = UNLINKED_MENTIONS.find((item) => item.index === index);
  const lines = [
    `# ${title}`,
    '',
    `Заметка ${index + 1} из раздела «${folder}».`,
    `Краткое описание процедуры и границ применимости для темы «${title}».`,
  ];
  if (unlinked) {
    lines.push(`Подробности были в «${unlinked.title}», но ссылка потерялась.`);
  }
  lines.push('', 'Порядок действий:', '- сверить входные данные', '- записать результат');
  if (tasks) {
    lines.push('- [ ] проверить результат');
  }
  if (linksHub) {
    lines.push('', `Связано с [[${HUBS[folder]}]].`);
  }
  const filler = random();
  lines.push('', `Служебный номер ${Math.floor(filler * 100000)}.`);
  return lines.join('\n');
}

export function generateCorpus({ root, seed = SEED } = {}) {
  const base = root || mkdtempSync(path.join(tmpdir(), 'obsidium-agent-bench-'));
  const vault = path.join(base, 'vault');
  if (existsSync(vault)) rmSync(vault, { recursive: true, force: true });
  mkdirSync(vault, { recursive: true });
  const random = mulberry32(seed);

  const notes = [];
  for (const anchor of ANCHORS) {
    const content = composeNote(anchor.meta, anchor.body);
    writeNote(vault, anchor.path, content);
    notes.push({
      path: anchor.path,
      title: titleOf(anchor.path),
      folder: folderOf(anchor.path),
      ...anchor.meta,
      bytes: Buffer.byteLength(content),
      lines: content.split('\n').length,
    });
  }

  const duplicatePairs = DUPLICATES.map((spec, index) => buildDuplicate(vault, spec, index));
  for (const pair of duplicatePairs) {
    const content = readFileSync(path.join(vault, pair.target), 'utf8');
    const meta = DUPLICATES[pair.index];
    notes.push({
      path: pair.target,
      title: titleOf(pair.target),
      folder: folderOf(pair.target),
      type: 'note',
      status: 'archive',
      tags: meta.tags,
      updated: meta.updated,
      bytes: Buffer.byteLength(content),
      lines: content.split('\n').length,
      duplicateOf: pair.source,
      overlap: pair.overlap,
    });
  }

  let fillerIndex = 0;
  const unlinkedPaths = new Map();
  for (const folder of FOLDERS) {
    const topics = FILLER_TOPICS[folder];
    for (const topic of topics) {
      const title = `${topic} ${String(fillerIndex + 1).padStart(2, '0')}`;
      const relPath = `${folder}/${title}.md`;
      const unlinked = UNLINKED_MENTIONS.find((item) => item.index === fillerIndex);
      if (unlinked) unlinkedPaths.set(unlinked.title, relPath);
      const body = buildFiller(folder, title, fillerIndex, random);
      const meta = {
        type: 'note',
        status: fillerIndex % 5 === 0 ? 'draft' : 'active',
        tags: FILLER_TAGS[folder],
        updated: `2025-${String((fillerIndex % 12) + 1).padStart(2, '0')}-${String((fillerIndex % 27) + 1).padStart(2, '0')}`,
      };
      const content = composeNote(meta, body);
      writeNote(vault, relPath, content);
      notes.push({
        path: relPath,
        title,
        folder,
        ...meta,
        bytes: Buffer.byteLength(content),
        lines: content.split('\n').length,
      });
      fillerIndex += 1;
    }
  }

  if (notes.length !== CORPUS_SIZE) {
    throw new Error(`corpus size ${notes.length}, expected ${CORPUS_SIZE}`);
  }

  const titles = new Map(notes.map((note) => [note.title, note.path]));
  const incoming = new Map(notes.map((note) => [note.path, 0]));
  const brokenLinks = [];
  for (const note of notes) {
    const content = readFileSync(path.join(vault, note.path), 'utf8');
    const links = [...content.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)]
      .map((match) => match[1].trim())
      .filter(Boolean);
    note.links = [...new Set(links)];
    note.tasks = (content.match(/^- \[[ x]\]/gm) || []).length;
    for (const link of note.links) {
      const target = titles.get(link);
      if (!target) {
        brokenLinks.push({ from: note.path, link });
      } else if (target !== note.path) {
        incoming.set(target, (incoming.get(target) || 0) + 1);
      }
    }
  }
  for (const note of notes) {
    note.incoming = incoming.get(note.path) || 0;
    note.orphan = note.incoming === 0 && (note.links || []).length === 0;
  }

  const largeNotes = notes.filter((note) => note.bytes > 20 * 1024);
  if (largeNotes.length !== 3) {
    throw new Error(`large notes ${largeNotes.length}, expected 3`);
  }
  if (duplicatePairs.length !== 6) {
    throw new Error(`duplicate pairs ${duplicatePairs.length}, expected 6`);
  }

  const manifest = {
    seed,
    vault,
    count: notes.length,
    folders: FOLDERS,
    notes: notes.sort((a, b) => a.path.localeCompare(b.path, 'ru')),
    features: {
      largeNotes: largeNotes.map((note) => note.path),
      duplicatePairs,
      contradictions: CONTRADICTIONS,
      brokenLinks,
      orphans: notes.filter((note) => note.orphan).map((note) => note.path),
      unlinkedMentions: UNLINKED_MENTIONS.map((item) => ({
        path: unlinkedPaths.get(item.title),
        title: item.title,
      })),
    },
  };
  return { base, vault, manifest };
}

function findLine(content, phrase) {
  const lines = content.split('\n');
  const index = lines.findIndex((line) => line.includes(phrase));
  if (index < 0) throw new Error(`phrase not found: ${phrase}`);
  return index + 1;
}

function expectedAt(vault, relPath, phrase) {
  const content = readFileSync(path.join(vault, relPath), 'utf8');
  if (!phrase) return { path: relPath };
  const line = findLine(content, phrase);
  return { path: relPath, lineStart: line, lineEnd: line };
}

const QUESTION_SPECS = [
  {
    id: 'q01-exact-rollout-undo',
    query: 'kubectl rollout undo deployment/api',
    lang: 'en',
    kind: 'exact',
    expected: [['Kubernetes/Откат деплоя.md', 'kubectl rollout undo deployment/api']],
    notes: 'Точная команда отката есть только в заметке про откат деплоя.',
  },
  {
    id: 'q02-exact-openssl',
    query: 'openssl s_client -connect example.com:443',
    lang: 'en',
    kind: 'exact',
    expected: [['TLS/Проверка цепочки сертификатов.md', 'openssl s_client -connect example.com:443']],
    notes: 'Точная команда проверки цепочки.',
  },
  {
    id: 'q03-exact-helm-upgrade',
    query: 'helm upgrade --atomic --timeout 10m',
    lang: 'en',
    kind: 'exact',
    expected: [['Kubernetes/Orphan-заметка про Helm.md', 'helm upgrade --atomic --timeout 10m']],
    notes: 'Точная команда helm есть в заметке-сироте, текстовый поиск должен её найти.',
  },
  {
    id: 'q04-exact-pg-dump',
    query: 'pg_dump -Fc --compress=9',
    lang: 'en',
    kind: 'exact',
    expected: [['Databases/Резервное копирование PostgreSQL.md', 'pg_dump -Fc --compress=9']],
    mustNotInclude: ['Архив/Резервное копирование PostgreSQL (v1).md'],
    notes: 'Точная команда с уровнем сжатия; в архивной копии сжатия нет.',
  },
  {
    id: 'q05-exact-cluster-issuer',
    query: 'ClusterIssuer letsencrypt-prod',
    lang: 'en',
    kind: 'exact',
    expected: [['Kubernetes/cert-manager.md', 'ClusterIssuer letsencrypt-prod']],
    notes: 'Имя ClusterIssuer встречается только в актуальной заметке cert-manager.',
  },
  {
    id: 'q06-ru-rollback',
    query: 'как откатить деплой в Kubernetes',
    lang: 'ru',
    kind: 'ru',
    expected: [['Kubernetes/Откат деплоя.md', 'kubectl rollout undo deployment/api']],
    notes: 'Русский запрос про откат; ответ — команда rollout undo.',
  },
  {
    id: 'q07-ru-backup-postgres',
    query: 'резервное копирование PostgreSQL',
    lang: 'ru',
    kind: 'ru',
    expected: [['Databases/Резервное копирование PostgreSQL.md', 'pg_dump -Fc --compress=9']],
    notes: 'Русский запрос про бэкап PostgreSQL.',
  },
  {
    id: 'q08-ru-key-rotation',
    query: 'ротация ключей TLS',
    lang: 'ru',
    kind: 'ru',
    expected: [['TLS/Ротация ключей.md', 'Ротация ключей позволяет продлить срок действия сертификата без простоя.']],
    notes: 'Русский запрос про ротацию ключей.',
  },
  {
    id: 'q09-ru-crashloop',
    query: 'почему поды падают в CrashLoopBackOff',
    lang: 'ru',
    kind: 'ru',
    expected: [['Kubernetes/Поды в CrashLoopBackOff.md', 'Если поды падают в CrashLoopBackOff, смотрите kubectl logs --previous.']],
    notes: 'Русский запрос про падающие поды.',
  },
  {
    id: 'q10-ru-jenkins-agents',
    query: 'настройка агентов Jenkins',
    lang: 'ru',
    kind: 'ru',
    expected: [['Jenkins/Агенты и метки.md', 'Настройка агентов Jenkins требует Java 11 на всех исполнителях.']],
    notes: 'Русский запрос про настройку агентов.',
  },
  {
    id: 'q11-en-hpa',
    query: 'horizontal pod autoscaler',
    lang: 'en',
    kind: 'en',
    expected: [['Kubernetes/Horizontal Pod Autoscaler.md', 'Horizontal Pod Autoscaler масштабирует поды по CPU.']],
    notes: 'Английский термин совпадает с заголовком заметки.',
  },
  {
    id: 'q12-en-502',
    query: 'nginx ingress 502 bad gateway',
    lang: 'en',
    kind: 'en',
    expected: [['Ingress/Ошибка 502.md', 'Ошибка 502 bad gateway чаще всего означает, что под не готов.']],
    notes: 'Английская формулировка ошибки 502.',
  },
  {
    id: 'q13-en-replication',
    query: 'postgres replication lag',
    lang: 'en',
    kind: 'en',
    expected: [['Databases/Репликация.md', 'postgres replication lag контролируется метрикой.']],
    notes: 'Английский термин про отставание репликации.',
  },
  {
    id: 'q14-en-parallel',
    query: 'jenkins parallel stages',
    lang: 'en',
    kind: 'en',
    expected: [['Jenkins/Параллельные стадии.md', 'Jenkins parallel stages ускоряют сборку за счёт параллельных шагов.']],
    notes: 'Английский термин про параллельные стадии.',
  },
  {
    id: 'q15-en-redis',
    query: 'redis persistence',
    lang: 'en',
    kind: 'en',
    expected: [['Databases/Redis.md', 'redis persistence настроен через AOF.']],
    notes: 'Английский термин про сохранение данных Redis.',
  },
  {
    id: 'q16-paraphrase-rollback',
    query: 'вернуть предыдущую версию приложения',
    lang: 'ru',
    kind: 'paraphrase',
    expected: [['Kubernetes/Откат деплоя.md', 'Так можно вернуть предыдущую версию приложения за несколько секунд.']],
    notes: 'Перефраз без слова «откат»; в заметке есть дословная формулировка.',
  },
  {
    id: 'q17-paraphrase-extend-cert',
    query: 'продлить срок действия сертификата',
    lang: 'ru',
    kind: 'paraphrase',
    expected: [['TLS/Ротация ключей.md', 'Ротация ключей позволяет продлить срок действия сертификата без простоя.']],
    notes: 'Перефраз про продление сертификата через ротацию.',
  },
  {
    id: 'q18-paraphrase-parallel-build',
    query: 'ускорить сборку за счёт параллельных шагов',
    lang: 'ru',
    kind: 'paraphrase',
    expected: [['Jenkins/Параллельные стадии.md', 'Jenkins parallel stages ускоряют сборку за счёт параллельных шагов.']],
    notes: 'Перефраз про ускорение сборки.',
  },
  {
    id: 'q19-paraphrase-memory-limit',
    query: 'ограничить потребление памяти контейнером',
    lang: 'ru',
    kind: 'paraphrase',
    expected: [['Kubernetes/Ресурсы и лимиты.md', 'Чтобы ограничить потребление памяти контейнером, задайте limits.memory.']],
    notes: 'Перефраз про лимиты памяти.',
  },
  {
    id: 'q20-paraphrase-slow-queries',
    query: 'найти медленные запросы в базе',
    lang: 'ru',
    kind: 'paraphrase',
    expected: [['Databases/Индексы и планы запросов.md', 'Медленные запросы ищутся через pg_stat_statements.']],
    notes: 'Перефраз про поиск медленных запросов.',
  },
  {
    id: 'q21-synthesis-cert-ingress',
    query: 'как cert-manager и ingress-nginx работают вместе',
    lang: 'ru',
    kind: 'synthesis',
    expected: [
      ['Kubernetes/cert-manager.md', 'ClusterIssuer letsencrypt-prod'],
      ['Ingress/TLS termination.md', 'TLS завершается на ingress-контроллере.'],
    ],
    notes: 'Нужны обе заметки: выдача сертификата и завершение TLS на контроллере.',
  },
  {
    id: 'q22-synthesis-commit-to-cluster',
    query: 'путь кода от коммита до кластера',
    lang: 'ru',
    kind: 'synthesis',
    expected: [
      ['Jenkins/Пайплайн деплоя.md', 'Пайплайн деплоя собирает образ и запускает выкладку.'],
      ['Ingress/Ingress для деплоя.md', 'Маршрут для выкладки приложения описан в этом манифесте.'],
    ],
    notes: 'Синтез: сборка в Jenkins и маршрут Ingress для выкладки.',
  },
  {
    id: 'q23-synthesis-postgres-backup',
    query: 'резервное копирование и восстановление PostgreSQL',
    lang: 'ru',
    kind: 'synthesis',
    expected: [
      ['Databases/Резервное копирование PostgreSQL.md', 'Файлы складываются в object storage.'],
      ['Databases/PostgreSQL.md', 'В продакшене используется PostgreSQL 16.'],
    ],
    notes: 'Синтез: бэкап и целевая версия PostgreSQL.',
  },
  {
    id: 'q24-synthesis-monitoring',
    query: 'мониторинг и алерты в кластере',
    lang: 'ru',
    kind: 'synthesis',
    expected: [
      ['Kubernetes/Мониторинг Prometheus.md', 'Prometheus собирает метрики с kubelet и приложений.'],
      ['Kubernetes/Обзор Kubernetes.md', 'Кластер работает на Kubernetes 1.30.2'],
    ],
    notes: 'Синтез: сбор метрик и общее описание кластера.',
  },
  {
    id: 'q25-synthesis-secrets-tls',
    query: 'безопасность секретов и TLS',
    lang: 'ru',
    kind: 'synthesis',
    expected: [
      ['Kubernetes/Секреты и ConfigMap.md', 'Секреты хранятся в Secret, конфигурация — в ConfigMap.'],
      ['TLS/Протоколы и шифры.md', 'Разрешены TLS 1.2 и TLS 1.3.'],
    ],
    notes: 'Синтез: хранение секретов и разрешённые версии TLS.',
  },
  {
    id: 'q26-graph-jenkins-ingress',
    query: 'как связаны Jenkins и Ingress',
    lang: 'ru',
    kind: 'graph',
    expected: [['Проекты/Мост Jenkins и Ingress.md']],
    notes: 'Мост между Jenkins и Ingress; проверяется обход графа.',
  },
  {
    id: 'q27-graph-two-hop',
    query: 'что находится на два шага от Jenkins в сторону Ingress',
    lang: 'ru',
    kind: 'graph',
    expected: [['Ingress/Ingress для деплоя.md']],
    notes: 'Два шага: пайплайн → мост → Ingress для деплоя.',
  },
  {
    id: 'q28-graph-kubernetes-tls',
    query: 'какие заметки связывают Kubernetes и TLS',
    lang: 'ru',
    kind: 'graph',
    expected: [['Kubernetes/Обзор Kubernetes.md'], ['TLS/Обзор TLS.md']],
    notes: 'Обзоры связаны ссылкой из Kubernetes в TLS.',
  },
  {
    id: 'q29-graph-jenkins-neighbors',
    query: 'соседи Jenkins по графу ссылок',
    lang: 'ru',
    kind: 'graph',
    expected: [['Jenkins/Обзор Jenkins.md'], ['Jenkins/Параллельные стадии.md']],
    notes: 'Хаб Jenkins и соседняя заметка про параллельные стадии.',
  },
  {
    id: 'q30-graph-databases-hub',
    query: 'что общего у PostgreSQL и Redis',
    lang: 'ru',
    kind: 'graph',
    expected: [['Databases/Обзор баз данных.md']],
    notes: 'Общий хаб базы данных связывает PostgreSQL и Redis.',
  },
  {
    id: 'q31-duplicate-ingress-port',
    query: 'service port 8443',
    lang: 'en',
    kind: 'duplicate',
    expected: [['Kubernetes/Настройка ingress-nginx.md', 'service port 8443']],
    mustNotInclude: ['Архив/Настройка ingress-nginx (копия).md'],
    notes: 'Ловушка near-duplicate: в архивной копии порт 8080.',
  },
  {
    id: 'q32-duplicate-letsencrypt-webroot',
    query: "letsencrypt webroot /var/www/letsencrypt",
    lang: 'en',
    kind: 'duplicate',
    expected: [["TLS/Выпуск сертификатов Let's Encrypt.md", 'webroot /var/www/letsencrypt']],
    mustNotInclude: ["Архив/Выпуск сертификатов Let's Encrypt (старое).md"],
    notes: 'Ловушка near-duplicate: в архиве webroot /srv/acme.',
  },
  {
    id: 'q33-duplicate-docker-build',
    query: 'docker build --pull --no-cache',
    lang: 'en',
    kind: 'duplicate',
    expected: [['Jenkins/Сборка Docker-образа.md', 'docker build --pull --no-cache']],
    mustNotInclude: ['Архив/Сборка Docker-образа (черновик).md'],
    notes: 'Ловушка near-duplicate: в черновике нет --pull.',
  },
  {
    id: 'q34-duplicate-pg-dump',
    query: 'pg_dump -Fc --compress=9',
    lang: 'en',
    kind: 'duplicate',
    expected: [['Databases/Резервное копирование PostgreSQL.md', 'pg_dump -Fc --compress=9']],
    mustNotInclude: ['Архив/Резервное копирование PostgreSQL (v1).md'],
    notes: 'Ловушка near-duplicate: в архивной копии нет сжатия.',
  },
  {
    id: 'q35-duplicate-path-type',
    query: 'pathType: Prefix',
    lang: 'en',
    kind: 'duplicate',
    expected: [['Ingress/Маршрутизация по путям.md', 'pathType: Prefix']],
    mustNotInclude: ['Архив/Маршрутизация по путям (копия).md'],
    notes: 'Ловушка near-duplicate: в копии ImplementationSpecific.',
  },
  {
    id: 'q36-duplicate-migration-count',
    query: 'миграция 42 сервиса',
    lang: 'ru',
    kind: 'duplicate',
    expected: [['Проекты/Миграция на Kubernetes.md', 'перенесли 42 сервиса']],
    mustNotInclude: ['Архив/Миграция на Kubernetes (старое).md'],
    notes: 'Ловушка near-duplicate: в архиве 37 сервисов.',
  },
  {
    id: 'q37-contradiction-cert-manager',
    query: 'какая версия cert-manager используется',
    lang: 'ru',
    kind: 'contradiction',
    expected: [
      ['Kubernetes/cert-manager.md', 'cert-manager 1.14.2'],
      ['Kubernetes/Установка cert-manager (старое).md', 'cert-manager 1.12.0'],
    ],
    notes: 'Две заметки называют разные версии; правильный ответ должен показать обе.',
  },
  {
    id: 'q38-contradiction-java',
    query: 'какая версия Java нужна агентам Jenkins',
    lang: 'ru',
    kind: 'contradiction',
    expected: [
      ['Jenkins/Агенты и метки.md', 'требует Java 11'],
      ['Jenkins/Агенты на Java 17.md', 'работают на Java 17'],
    ],
    notes: 'Противоречие про Java 11 и Java 17.',
  },
  {
    id: 'q39-contradiction-postgres',
    query: 'PostgreSQL 14 16',
    lang: 'ru',
    kind: 'contradiction',
    expected: [
      ['Databases/PostgreSQL.md', 'используется PostgreSQL 16'],
      ['Databases/PostgreSQL 14 (старое).md', 'стоял PostgreSQL 14'],
    ],
    notes: 'Противоречие про PostgreSQL 14 и 16.',
  },
  {
    id: 'q40-contradiction-timeout',
    query: 'proxy-read-timeout',
    lang: 'en',
    kind: 'contradiction',
    expected: [
      ['Ingress/Аннотации ingress-nginx.md', 'proxy-read-timeout: 60'],
      ['Ingress/Аннотации nginx (новые).md', 'proxy-read-timeout: 300'],
    ],
    notes: 'Противоречие про таймаут 60 и 300 секунд.',
  },
  {
    id: 'q41-contradiction-kubernetes',
    query: 'какая версия Kubernetes в кластере',
    lang: 'ru',
    kind: 'contradiction',
    expected: [
      ['Kubernetes/Версия кластера.md', 'развёрнут Kubernetes 1.30.2'],
      ['Архив/Версия кластера (2023).md', 'работал на Kubernetes 1.27.4'],
    ],
    notes: 'Противоречие про версии Kubernetes 1.30.2 и 1.27.4.',
  },
  {
    id: 'q42-stale-postgres',
    query: 'актуальная версия PostgreSQL',
    lang: 'ru',
    kind: 'stale',
    expected: [['Databases/PostgreSQL.md', 'используется PostgreSQL 16']],
    mustNotInclude: ['Databases/PostgreSQL 14 (старое).md'],
    notes: 'Старые данные не должны выдаваться за актуальные.',
  },
  {
    id: 'q43-stale-cert-manager',
    query: 'актуальная версия cert-manager',
    lang: 'ru',
    kind: 'stale',
    expected: [['Kubernetes/cert-manager.md', 'cert-manager 1.14.2']],
    mustNotInclude: ['Kubernetes/Установка cert-manager (старое).md'],
    notes: 'Старая инструкция 2023 года не должна быть ответом.',
  },
  {
    id: 'q44-stale-kubernetes',
    query: 'актуальная версия Kubernetes',
    lang: 'ru',
    kind: 'stale',
    expected: [['Kubernetes/Версия кластера.md', 'развёрнут Kubernetes 1.30.2']],
    mustNotInclude: ['Архив/Версия кластера (2023).md'],
    notes: 'Архивная версия 1.27.4 устарела.',
  },
  {
    id: 'q45-large-worker-zone',
    query: 'eu-west-1c',
    lang: 'en',
    kind: 'large',
    expected: [['Kubernetes/Большая карта кластера.md', 'Узел worker-17 находится в зоне eu-west-1c']],
    notes: 'Ответ глубоко в заметке больше 20 КБ.',
  },
  {
    id: 'q46-large-incident',
    query: 'RabbitMQ переполнилась',
    lang: 'ru',
    kind: 'large',
    expected: [['Архив/Большой разбор инцидента.md', 'Инцидент 2024-03-14: очередь RabbitMQ переполнилась']],
    notes: 'Ответ глубоко в большом разборе инцидента.',
  },
  {
    id: 'q47-large-slow-join',
    query: 'таблице orders',
    lang: 'ru',
    kind: 'large',
    expected: [['Databases/Огромный справочник SQL.md', 'Самый медленный JOIN на таблице orders']],
    notes: 'Ответ глубоко в огромном справочнике SQL.',
  },
  {
    id: 'q48-empty-terraform',
    query: 'terraform dynamodb',
    lang: 'en',
    kind: 'empty',
    expected: [],
    notes: 'В корпусе нет Terraform и DynamoDB; любой результат — ложное срабатывание.',
  },
  {
    id: 'q49-empty-kafka',
    query: 'kafka consumer',
    lang: 'en',
    kind: 'empty',
    expected: [],
    notes: 'В корпусе нет Kafka; любой результат — ложное срабатывание.',
  },
  {
    id: 'q50-empty-angular',
    query: 'angular prerender',
    lang: 'en',
    kind: 'empty',
    expected: [],
    notes: 'В корпусе нет Angular; любой результат — ложное срабатывание.',
  },
];

export function buildQuestions({ vault }) {
  return QUESTION_SPECS.map((spec) => {
    const expected = spec.expected.map(([relPath, phrase]) => expectedAt(vault, relPath, phrase));
    const question = {
      id: spec.id,
      query: spec.query,
      lang: spec.lang,
      kind: spec.kind,
      expected,
      notes: spec.notes,
    };
    if (spec.mustNotInclude) question.mustNotInclude = spec.mustNotInclude;
    return question;
  });
}

export function writeQuestions({ vault, file }) {
  const questions = buildQuestions({ vault });
  writeFileSync(file, `${JSON.stringify(questions, null, 2)}\n`, 'utf8');
  return questions;
}

function main() {
  const args = process.argv.slice(2);
  const value = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const out = value('--out');
  const questionsFile = value('--questions');
  const manifestFile = value('--manifest');
  const { base, vault, manifest } = generateCorpus({ root: out });
  if (questionsFile) writeQuestions({ vault, file: questionsFile });
  if (manifestFile) {
    writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(
    `${JSON.stringify({
      base,
      vault,
      count: manifest.count,
      seed: manifest.seed,
      questions: questionsFile || null,
      manifest: manifestFile || null,
    }, null, 2)}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
