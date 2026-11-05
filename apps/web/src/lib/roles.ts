export type Role =
  "OWNER" | "ADMIN" | "SCRUM_MASTER" | "PRODUCT_OWNER" | "DEVELOPER" | "VIEWER";

export const ASSIGNABLE_ROLES: Exclude<Role, "OWNER">[] = [
  "ADMIN",
  "SCRUM_MASTER",
  "PRODUCT_OWNER",
  "DEVELOPER",
  "VIEWER",
];

const LABELS: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  SCRUM_MASTER: "Scrum Master",
  PRODUCT_OWNER: "Product Owner",
  DEVELOPER: "Developer",
  VIEWER: "Viewer",
};

export const roleLabel = (role: Role) => LABELS[role];
