import Expense from "../Models/expense.js";
import Income from "../Models/income.js";
import Transfer from "../Models/transfer.js";
import Subcategory from "../Models/subcategory.js";

// Records reference accounts/categories/subcategories by name, so renames and deletes must be
// propagated here. Mirrors the mobile behaviour in src/lib/db/queries.js. updateMany bumps
// `updatedAt`, so affected records are picked up by the next mobile delta pull.

export const renameAccountRefs = async (oldName, newName) => {
  await Promise.all([
    Expense.updateMany({ accountName: oldName }, { $set: { accountName: newName } }),
    Income.updateMany({ accountName: oldName }, { $set: { accountName: newName } }),
    Transfer.updateMany({ fromAccountName: oldName }, { $set: { fromAccountName: newName } }),
    Transfer.updateMany({ toAccountName: oldName }, { $set: { toAccountName: newName } }),
  ]);
};

// Transactions are unassigned (not deleted); transfers touching the account are removed.
export const detachAccountRefs = async (name) => {
  await Promise.all([
    Expense.updateMany({ accountName: name }, { $set: { accountName: null } }),
    Income.updateMany({ accountName: name }, { $set: { accountName: null } }),
    Transfer.deleteMany({ $or: [{ fromAccountName: name }, { toAccountName: name }] }),
  ]);
};

export const renameCategoryRefs = async (oldName, newName) => {
  await Promise.all([
    Expense.updateMany({ category: oldName }, { $set: { category: newName } }),
    Subcategory.updateMany({ categoryName: oldName }, { $set: { categoryName: newName } }),
  ]);
};

// Expenses fall back to "General" with no subcategory; the category's subcategories are removed.
export const detachCategoryRefs = async (name) => {
  await Expense.updateMany({ category: name }, { $set: { category: "General", subcategory: null } });
  await Subcategory.deleteMany({ categoryName: name });
};

export const renameSubcategoryRefs = async (categoryName, oldName, newName) => {
  await Expense.updateMany(
    { category: categoryName, subcategory: oldName },
    { $set: { subcategory: newName } }
  );
};

export const detachSubcategoryRefs = async (categoryName, name) => {
  await Expense.updateMany(
    { category: categoryName, subcategory: name },
    { $set: { subcategory: null } }
  );
};
