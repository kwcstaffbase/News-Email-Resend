import "i18next";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "template";
    resources: {
      template: typeof import("./locales/en/template.json");
      admin: typeof import("./locales/en/admin.json");
    };
  }
}
