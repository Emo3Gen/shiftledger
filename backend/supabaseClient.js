// Заготовка под будущую интеграцию с Supabase.
// Пока не используется, но структура проекта к этому готова.
//
// Чтобы активировать:
//   1. Установить зависимость:  npm install @supabase/supabase-js
//   2. Раскомментировать код ниже.
//
// import { createClient } from "@supabase/supabase-js";
//
// const supabaseUrl = process.env.SUPABASE_URL;
// const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
//
// if (!supabaseUrl || !supabaseServiceRoleKey) {
//   console.warn("[supabase] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY не заданы, Supabase отключён");
// }
//
// export const supabase =
//   supabaseUrl && supabaseServiceRoleKey
//     ? createClient(supabaseUrl, supabaseServiceRoleKey, {
//         auth: { persistSession: false },
//       })
//     : null;

