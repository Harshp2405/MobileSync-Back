import Account from "../Models/account.js";
import Category from "../Models/category.js";
import { HttpError, requireTrimmedString } from "./http.js";

export const assertAccountRefs = async (fields) => {
  for (const field of ["accountName", "fromAccountName", "toAccountName"]) {
    if (fields[field] === undefined || fields[field] === null) continue;
    const name = requireTrimmedString(fields[field], field);
    if (!(await Account.exists({ name }))) {
      throw new HttpError(400, `Unknown account in '${field}': ${name}`);
    }
  }
};

export const assertCategoryRef = async (categoryName) => {
  const name = requireTrimmedString(categoryName, "categoryName");
  if (!(await Category.exists({ name }))) {
    throw new HttpError(400, `Unknown category: ${name}`);
  }
};
