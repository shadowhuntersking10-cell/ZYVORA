import type { Lang } from '../store/prefs';

/** All strings of the public pages (landing, register, login, verification, password reset). */
export interface PubDict {
  tagline: string;
  headline: string;
  subline: string;
  cta_start: string;
  cta_login: string;
  features: [string, string, string];
  preview_caption: string;
  intro_skip: string;
  intro_show: string;
  studios_title: string;
  studios_sub: string;
  status_available: string;
  status_partial: string;
  status_soon: string;
  studio_2d: string; studio_2d_desc: string;
  studio_3d: string; studio_3d_desc: string;
  studio_char: string; studio_char_desc: string;
  studio_anim: string; studio_anim_desc: string;
  studio_cine: string; studio_cine_desc: string;
  studio_ai: string; studio_ai_desc: string;
  final_title: string;
  final_sub: string;
  footer_terms: string;
  footer_privacy: string;
  footer_rights: string;
  back_home: string;
  loading: string;
  // forms
  f_name: string;
  f_email: string;
  f_password: string;
  f_confirm: string;
  f_remember: string;
  f_terms: string;
  show_password: string;
  hide_password: string;
  strength_label: string;
  strength_0: string; strength_1: string; strength_2: string; strength_3: string; strength_4: string;
  rules_title: string;
  rule_len: string;
  rule_case: string;
  rule_digit: string;
  register_title: string;
  register_sub: string;
  submit_register: string;
  have_account: string;
  login_link: string;
  login_title: string;
  login_sub: string;
  submit_login: string;
  forgot_link: string;
  no_account: string;
  create_link: string;
  // errors
  err_name: string;
  err_email: string;
  err_password: string;
  err_confirm: string;
  err_terms: string;
  err_email_taken: string;
  err_bad_credentials: string;
  err_unverified: string;
  err_unverified_link: string;
  err_blocked: string;
  err_network: string;
  err_generic: string;
  err_reset_invalid: string;
  err_verify_invalid: string;
  // check email
  check_title: string;
  check_sub: string;
  check_sub_none: string;
  resend: string;
  resend_in: string;
  resend_sent: string;
  resend_not_connected: string;
  change_email: string;
  // verify email
  verify_title: string;
  verify_sub: string;
  verifying: string;
  verify_ok_title: string;
  verify_ok_sub: string;
  verify_fail_title: string;
  verify_fail_sub: string;
  to_dashboard: string;
  // forgot / reset
  forgot_title: string;
  forgot_sub: string;
  forgot_submit: string;
  forgot_done_title: string;
  forgot_done_sub: string;
  forgot_not_connected: string;
  reset_title: string;
  reset_sub: string;
  new_password: string;
  reset_submit: string;
  reset_done_title: string;
  reset_done_sub: string;
  reset_fail_title: string;
  reset_fail_sub: string;
  request_new: string;
  // legal
  terms_title: string;
  privacy_title: string;
  legal_pending: string;
}

const en: PubDict = {
  tagline: 'AI-assisted anime, 3D and cinema',
  headline: 'Create anime, 3D and cinema in one place',
  subline: 'Design a character, turn it into a 3D model, animate it and build the scene. One workspace, one project.',
  cta_start: 'Get started',
  cta_login: 'Log in',
  features: [
    '2D → 3D → Animation → Cinema, in one pipeline',
    'An AI assistant docked in every studio',
    'One project, one workspace, one shared document',
  ],
  preview_caption: 'Illustration of the timeline. Not a product screenshot.',
  intro_skip: 'Skip intro',
  intro_show: 'Play intro',
  studios_title: 'Six studios, one workspace',
  studios_sub: 'Each studio reads and writes the same project. Status is shown honestly on every card.',
  status_available: 'Available',
  status_partial: 'Partially available',
  status_soon: 'Coming soon',
  studio_2d: '2D Studio', studio_2d_desc: 'Sketch, paint and build concept art on layers.',
  studio_3d: '3D Studio', studio_3d_desc: 'Add primitives, move and scale them, and edit materials in a live viewport.',
  studio_char: 'Character Studio', studio_char_desc: 'Design a character with views, expressions and a consistent look.',
  studio_anim: 'Animation Studio', studio_anim_desc: 'Keyframe your objects and preview the motion on the timeline.',
  studio_cine: 'Cinema Studio', studio_cine_desc: 'Arrange shots, cameras and audio into a sequence.',
  studio_ai: 'AI Image & Video Lab', studio_ai_desc: 'Generate images from text. Video is not connected yet.',
  final_title: 'Start your first project',
  final_sub: 'Free to create an account. AI generation uses credits and always asks you to confirm the cost first.',
  footer_terms: 'Terms',
  footer_privacy: 'Privacy',
  footer_rights: 'All rights reserved.',
  back_home: 'Back to home',
  loading: 'Loading…',
  f_name: 'Full name',
  f_email: 'Email',
  f_password: 'Password',
  f_confirm: 'Confirm password',
  f_remember: 'Remember me',
  f_terms: 'I agree to the Terms and Privacy Policy',
  show_password: 'Show password',
  hide_password: 'Hide password',
  strength_label: 'Password strength',
  strength_0: 'Too short', strength_1: 'Weak', strength_2: 'Fair', strength_3: 'Good', strength_4: 'Strong',
  rules_title: 'Password must have',
  rule_len: '8 or more characters',
  rule_case: 'Upper and lower case letters',
  rule_digit: 'At least one number',
  register_title: 'Create your account',
  register_sub: 'Start creating in a few seconds.',
  submit_register: 'Create account',
  have_account: 'Already have an account?',
  login_link: 'Log in',
  login_title: 'Welcome back',
  login_sub: 'Log in to continue your projects.',
  submit_login: 'Log in',
  forgot_link: 'Forgot password?',
  no_account: "Don't have an account?",
  create_link: 'Create account',
  err_name: 'Enter your name.',
  err_email: 'Enter a valid email address.',
  err_password: 'Password does not meet the rules below.',
  err_confirm: 'Passwords do not match.',
  err_terms: 'You must accept the Terms and Privacy Policy.',
  err_email_taken: 'This email is already registered. Log in or reset your password.',
  err_bad_credentials: 'Wrong email or password.',
  err_unverified: 'Please verify your email before logging in.',
  err_unverified_link: 'Resend verification email',
  err_blocked: 'This account is blocked. Contact support.',
  err_network: 'Cannot reach the server. Check your connection and try again.',
  err_generic: 'Something went wrong. Please try again.',
  err_reset_invalid: 'This reset link is invalid or has expired.',
  err_verify_invalid: 'This verification link is invalid or has expired.',
  check_title: 'Check your email',
  check_sub: 'We sent a verification link to {email}. Open it to activate your account.',
  check_sub_none: 'Open the verification link we sent to your email address to activate your account.',
  resend: 'Resend email',
  resend_in: 'Resend in {s}s',
  resend_sent: 'A new verification email was sent.',
  resend_not_connected: 'Email delivery is not connected on this server yet, so no email was sent.',
  change_email: 'Change email',
  verify_title: 'Verifying your email',
  verify_sub: 'This takes a moment.',
  verifying: 'Verifying…',
  verify_ok_title: 'Email verified',
  verify_ok_sub: 'Your account is active. You can start a project now.',
  verify_fail_title: 'Verification failed',
  verify_fail_sub: 'The link may be used or expired. Log in to request a new one.',
  to_dashboard: 'Go to dashboard',
  forgot_title: 'Reset your password',
  forgot_sub: 'Enter your email and we will send a reset link if an account exists.',
  forgot_submit: 'Send reset link',
  forgot_done_title: 'Check your email',
  forgot_done_sub: 'If an account exists for this email, a reset link is on its way.',
  forgot_not_connected: 'Email delivery is not connected on this server yet, so no link was sent.',
  reset_title: 'Choose a new password',
  reset_sub: 'Use a password you have not used before.',
  new_password: 'New password',
  reset_submit: 'Set new password',
  reset_done_title: 'Password updated',
  reset_done_sub: 'You can log in with your new password now.',
  reset_fail_title: 'Link not valid',
  reset_fail_sub: 'Request a new reset link and try again.',
  request_new: 'Request a new link',
  terms_title: 'Terms of Service',
  privacy_title: 'Privacy Policy',
  legal_pending: 'The full legal text is not published yet. Until it is, these pages state only that it is pending.',
};

const uz: PubDict = {
  tagline: 'AI yordamidagi anime, 3D va kino',
  headline: 'Anime, 3D va kinoni bir joyda yarating',
  subline: 'Qahramon yarating, uni 3D modelga aylantiring, animatsiya qiling va sahna quring. Bitta ish maydoni, bitta loyiha.',
  cta_start: 'Boshlash',
  cta_login: 'Kirish',
  features: [
    '2D → 3D → Animatsiya → Kino, bitta jarayonda',
    'Har bir studiyada AI yordamchi',
    'Bitta loyiha, bitta ish maydoni, bitta umumiy hujjat',
  ],
  preview_caption: 'Vaqt jadvali tasviri. Mahsulot skrinshoti emas.',
  intro_skip: 'Kirishni o‘tkazib yuborish',
  intro_show: 'Kirishni ijro etish',
  studios_title: 'Olti studiya, bitta ish maydoni',
  studios_sub: 'Har bir studiya bir xil loyihani o‘qiydi va o‘zgartiradi. Holat har bir kartada ochiq ko‘rsatiladi.',
  status_available: 'Mavjud',
  status_partial: 'Qisman mavjud',
  status_soon: 'Tez orada',
  studio_2d: '2D studiya', studio_2d_desc: 'Qatlamlarda eskiz, bo‘yoq va konsept-art yarating.',
  studio_3d: '3D studiya', studio_3d_desc: 'Primitivlar qo‘shing, siljiting va jonli ko‘rinishda materiallarni tahrirlang.',
  studio_char: 'Qahramon studiyasi', studio_char_desc: 'Qahramonni ko‘rinishlar, ifodalar va bir xil qiyofa bilan loyihalang.',
  studio_anim: 'Animatsiya studiyasi', studio_anim_desc: 'Obyektlarga kalit kadrlar qo‘ying va harakatni vaqt jadvalida ko‘ring.',
  studio_cine: 'Kino studiyasi', studio_cine_desc: 'Kadrlar, kameralar va audioni ketma-ketlikka joylang.',
  studio_ai: 'AI rasm va video laboratoriyasi', studio_ai_desc: 'Matndan rasm yarating. Video hali ulanmagan.',
  final_title: 'Birinchi loyihangizni boshlang',
  final_sub: 'Hisob yaratish bepul. AI generatsiyasi kredit sarflaydi va narxni avval tasdiqlashni so‘raydi.',
  footer_terms: 'Shartlar',
  footer_privacy: 'Maxfiylik',
  footer_rights: 'Barcha huquqlar himoyalangan.',
  back_home: 'Bosh sahifaga',
  loading: 'Yuklanmoqda…',
  f_name: 'To‘liq ism',
  f_email: 'Elektron pochta',
  f_password: 'Parol',
  f_confirm: 'Parolni tasdiqlang',
  f_remember: 'Meni eslab qol',
  f_terms: 'Foydalanish shartlari va Maxfiylik siyosatiga roziman',
  show_password: 'Parolni ko‘rsatish',
  hide_password: 'Parolni yashirish',
  strength_label: 'Parol kuchi',
  strength_0: 'Juda qisqa', strength_1: 'Zaif', strength_2: 'Qoniqarli', strength_3: 'Yaxshi', strength_4: 'Kuchli',
  rules_title: 'Parolda bo‘lishi kerak',
  rule_len: '8 yoki undan ko‘p belgi',
  rule_case: 'Katta va kichik harflar',
  rule_digit: 'Kamida bitta raqam',
  register_title: 'Hisobingizni yarating',
  register_sub: 'Bir necha soniyada yaratishni boshlang.',
  submit_register: 'Hisob yaratish',
  have_account: 'Hisobingiz bormi?',
  login_link: 'Kirish',
  login_title: 'Xush kelibsiz',
  login_sub: 'Loyihalaringizni davom ettirish uchun kiring.',
  submit_login: 'Kirish',
  forgot_link: 'Parolni unutdingizmi?',
  no_account: 'Hisobingiz yo‘qmi?',
  create_link: 'Hisob yaratish',
  err_name: 'Ismingizni kiriting.',
  err_email: 'To‘g‘ri elektron pochta kiriting.',
  err_password: 'Parol quyidagi talablarga javob bermaydi.',
  err_confirm: 'Parollar mos emas.',
  err_terms: 'Shartlar va Maxfiylik siyosatini qabul qilishingiz kerak.',
  err_email_taken: 'Bu pochta allaqachon ro‘yxatdan o‘tgan. Kiring yoki parolni tiklang.',
  err_bad_credentials: 'Elektron pochta yoki parol noto‘g‘ri.',
  err_unverified: 'Kirishdan oldin elektron pochtangizni tasdiqlang.',
  err_unverified_link: 'Tasdiqlash xatini qayta yuborish',
  err_blocked: 'Bu hisob bloklangan. Qo‘llab-quvvatlash bilan bog‘laning.',
  err_network: 'Serverga ulanib bo‘lmadi. Aloqani tekshirib, qayta urining.',
  err_generic: 'Xatolik yuz berdi. Qayta urinib ko‘ring.',
  err_reset_invalid: 'Tiklash havolasi noto‘g‘ri yoki muddati o‘tgan.',
  err_verify_invalid: 'Tasdiqlash havolasi noto‘g‘ri yoki muddati o‘tgan.',
  check_title: 'Elektron pochtangizni tekshiring',
  check_sub: '{email} manziliga tasdiqlash havolasi yuborildi. Hisobni faollashtirish uchun uni oching.',
  check_sub_none: 'Hisobni faollashtirish uchun elektron pochtangizga yuborilgan tasdiqlash havolasini oching.',
  resend: 'Xatni qayta yuborish',
  resend_in: '{s} soniyadan keyin qayta yuborish',
  resend_sent: 'Yangi tasdiqlash xati yuborildi.',
  resend_not_connected: 'Bu serverda elektron pochta yetkazish hali ulanmagan, shuning uchun xat yuborilmadi.',
  change_email: 'Pochtani o‘zgartirish',
  verify_title: 'Elektron pochta tasdiqlanmoqda',
  verify_sub: 'Bir oz vaqt oladi.',
  verifying: 'Tasdiqlanmoqda…',
  verify_ok_title: 'Elektron pochta tasdiqlandi',
  verify_ok_sub: 'Hisobingiz faol. Endi loyiha boshlashingiz mumkin.',
  verify_fail_title: 'Tasdiqlash amalga oshmadi',
  verify_fail_sub: 'Havola ishlatilgan yoki muddati o‘tgan bo‘lishi mumkin. Yangisini so‘rash uchun kiring.',
  to_dashboard: 'Boshqaruv paneliga o‘tish',
  forgot_title: 'Parolni tiklang',
  forgot_sub: 'Elektron pochtani kiriting. Hisob mavjud bo‘lsa, tiklash havolasini yuboramiz.',
  forgot_submit: 'Tiklash havolasini yuborish',
  forgot_done_title: 'Elektron pochtangizni tekshiring',
  forgot_done_sub: 'Bu pochta uchun hisob mavjud bo‘lsa, tiklash havolasi yo‘lda.',
  forgot_not_connected: 'Bu serverda elektron pochta yetkazish hali ulanmagan, shuning uchun havola yuborilmadi.',
  reset_title: 'Yangi parol tanlang',
  reset_sub: 'Oldin ishlatilmagan parol kiriting.',
  new_password: 'Yangi parol',
  reset_submit: 'Yangi parolni o‘rnatish',
  reset_done_title: 'Parol yangilandi',
  reset_done_sub: 'Endi yangi parol bilan kirishingiz mumkin.',
  reset_fail_title: 'Havola yaroqsiz',
  reset_fail_sub: 'Yangi tiklash havolasini so‘rang va qayta urining.',
  request_new: 'Yangi havola so‘rash',
  terms_title: 'Foydalanish shartlari',
  privacy_title: 'Maxfiylik siyosati',
  legal_pending: 'To‘liq huquqiy matn hali e’lon qilinmagan. Shu vaqtgacha bu sahifalar faqat matn tayyorlanayotganini bildiradi.',
};

const ru: PubDict = {
  tagline: 'Аниме, 3D и кино с помощью ИИ',
  headline: 'Создавайте аниме, 3D и кино в одном месте',
  subline: 'Создайте персонажа, превратите его в 3D-модель, анимируйте и соберите сцену. Одно рабочее пространство, один проект.',
  cta_start: 'Начать',
  cta_login: 'Войти',
  features: [
    '2D → 3D → Анимация → Кино, в одном процессе',
    'ИИ-помощник в каждой студии',
    'Один проект, одно пространство, один общий документ',
  ],
  preview_caption: 'Иллюстрация таймлайна. Это не скриншот продукта.',
  intro_skip: 'Пропустить вступление',
  intro_show: 'Включить вступление',
  studios_title: 'Шесть студий, одно пространство',
  studios_sub: 'Каждая студия читает и меняет один и тот же проект. Статус честно указан на каждой карточке.',
  status_available: 'Доступно',
  status_partial: 'Частично доступно',
  status_soon: 'Скоро',
  studio_2d: '2D-студия', studio_2d_desc: 'Эскизы, живопись и концепт-арт по слоям.',
  studio_3d: '3D-студия', studio_3d_desc: 'Добавляйте примитивы, двигайте и масштабируйте их, меняйте материалы во вьюпорте.',
  studio_char: 'Студия персонажей', studio_char_desc: 'Создавайте персонажа с видами, выражениями и единым образом.',
  studio_anim: 'Студия анимации', studio_anim_desc: 'Ставьте ключевые кадры и смотрите движение на таймлайне.',
  studio_cine: 'Киностудия', studio_cine_desc: 'Собирайте кадры, камеры и звук в последовательность.',
  studio_ai: 'Лаборатория ИИ: изображения и видео', studio_ai_desc: 'Генерация изображений по тексту. Видео пока не подключено.',
  final_title: 'Начните первый проект',
  final_sub: 'Аккаунт создаётся бесплатно. Генерация ИИ расходует кредиты и всегда сначала просит подтвердить стоимость.',
  footer_terms: 'Условия',
  footer_privacy: 'Конфиденциальность',
  footer_rights: 'Все права защищены.',
  back_home: 'На главную',
  loading: 'Загрузка…',
  f_name: 'Полное имя',
  f_email: 'Email',
  f_password: 'Пароль',
  f_confirm: 'Подтвердите пароль',
  f_remember: 'Запомнить меня',
  f_terms: 'Я согласен с Условиями и Политикой конфиденциальности',
  show_password: 'Показать пароль',
  hide_password: 'Скрыть пароль',
  strength_label: 'Надёжность пароля',
  strength_0: 'Слишком короткий', strength_1: 'Слабый', strength_2: 'Средний', strength_3: 'Хороший', strength_4: 'Надёжный',
  rules_title: 'Пароль должен содержать',
  rule_len: '8 или больше символов',
  rule_case: 'Заглавные и строчные буквы',
  rule_digit: 'Хотя бы одну цифру',
  register_title: 'Создайте аккаунт',
  register_sub: 'Начните создавать за несколько секунд.',
  submit_register: 'Создать аккаунт',
  have_account: 'Уже есть аккаунт?',
  login_link: 'Войти',
  login_title: 'С возвращением',
  login_sub: 'Войдите, чтобы продолжить свои проекты.',
  submit_login: 'Войти',
  forgot_link: 'Забыли пароль?',
  no_account: 'Нет аккаунта?',
  create_link: 'Создать аккаунт',
  err_name: 'Введите имя.',
  err_email: 'Введите корректный email.',
  err_password: 'Пароль не соответствует требованиям ниже.',
  err_confirm: 'Пароли не совпадают.',
  err_terms: 'Нужно принять Условия и Политику конфиденциальности.',
  err_email_taken: 'Этот email уже зарегистрирован. Войдите или восстановите пароль.',
  err_bad_credentials: 'Неверный email или пароль.',
  err_unverified: 'Подтвердите email, прежде чем войти.',
  err_unverified_link: 'Отправить письмо повторно',
  err_blocked: 'Этот аккаунт заблокирован. Свяжитесь с поддержкой.',
  err_network: 'Нет связи с сервером. Проверьте подключение и попробуйте снова.',
  err_generic: 'Что-то пошло не так. Попробуйте ещё раз.',
  err_reset_invalid: 'Ссылка для сброса недействительна или истекла.',
  err_verify_invalid: 'Ссылка подтверждения недействительна или истекла.',
  check_title: 'Проверьте почту',
  check_sub: 'Мы отправили ссылку подтверждения на {email}. Откройте её, чтобы активировать аккаунт.',
  check_sub_none: 'Откройте ссылку подтверждения, которую мы отправили на ваш email, чтобы активировать аккаунт.',
  resend: 'Отправить письмо повторно',
  resend_in: 'Повторная отправка через {s} с',
  resend_sent: 'Новое письмо с подтверждением отправлено.',
  resend_not_connected: 'Отправка email на этом сервере ещё не подключена, поэтому письмо не отправлено.',
  change_email: 'Изменить email',
  verify_title: 'Подтверждение email',
  verify_sub: 'Это займёт несколько секунд.',
  verifying: 'Подтверждение…',
  verify_ok_title: 'Email подтверждён',
  verify_ok_sub: 'Аккаунт активен. Можно начинать проект.',
  verify_fail_title: 'Не удалось подтвердить',
  verify_fail_sub: 'Ссылка могла быть использована или истечь. Войдите, чтобы запросить новую.',
  to_dashboard: 'Перейти в панель',
  forgot_title: 'Сброс пароля',
  forgot_sub: 'Введите email. Если аккаунт существует, мы отправим ссылку для сброса.',
  forgot_submit: 'Отправить ссылку',
  forgot_done_title: 'Проверьте почту',
  forgot_done_sub: 'Если для этого email есть аккаунт, ссылка для сброса уже в пути.',
  forgot_not_connected: 'Отправка email на этом сервере ещё не подключена, поэтому ссылка не отправлена.',
  reset_title: 'Новый пароль',
  reset_sub: 'Используйте пароль, которого раньше не было.',
  new_password: 'Новый пароль',
  reset_submit: 'Сохранить новый пароль',
  reset_done_title: 'Пароль обновлён',
  reset_done_sub: 'Теперь можно войти с новым паролем.',
  reset_fail_title: 'Ссылка недействительна',
  reset_fail_sub: 'Запросите новую ссылку и попробуйте снова.',
  request_new: 'Запросить новую ссылку',
  terms_title: 'Условия использования',
  privacy_title: 'Политика конфиденциальности',
  legal_pending: 'Полный юридический текст ещё не опубликован. Пока эти страницы лишь сообщают, что текст готовится.',
};

export const publicCopy: Record<Lang, PubDict> = { en, uz, ru };

/** Replaces {placeholders} in a copy string. */
export function fill(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}
