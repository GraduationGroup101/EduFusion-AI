import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['**/node_modules/**','**/dist/**','frontend/public/**'] },
  js.configs.recommended,
  { files: ['backend/**/*.js'], languageOptions: { sourceType:'commonjs', globals:globals.node },
    rules: { 'no-unused-vars':['error',{argsIgnorePattern:'^_',caughtErrors:'none'}] } },
  { files: ['frontend/**/*.{js,jsx}'], languageOptions: { sourceType:'module', globals:{...globals.browser,...globals.node}, parserOptions:{ecmaFeatures:{jsx:true}} },
    rules:{ 'no-unused-vars':['error',{varsIgnorePattern:'^[A-Z]',argsIgnorePattern:'^_',caughtErrors:'none'}] } },
];
