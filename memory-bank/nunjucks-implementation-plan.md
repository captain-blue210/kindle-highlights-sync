# Nunjucks Template Implementation Plan

This plan outlines the steps to integrate Nunjucks templating into the Kindle Highlights Sync plugin, replacing the previous simple string replacement mechanism.

## Proposed Nunjucks Template

```nunjucks
---
aliases:
tags: ["読書/{{author}}/{{title}}"]
created:
updated:
---

{% if imageUrl %}![image]({{imageUrl}})
{% endif %}

## 書籍情報
{% trim %}
{% if authorUrl %}
* 著者: [{{author}}]({{authorUrl}})
{% elif author %}
* 著者: [[{{author}}]]
{% endif %}
{% if highlightsCount %}* ハイライト数: {{highlightsCount}}{% endif %}
{% if lastAnnotatedDate %}* 最後にハイライトした日: {{lastAnnotatedDate}}{% endif %}
{% if publicationDate %}* 発行日: {{publicationDate}}{% endif %}
{% if publisher %}* 出版社: {{publisher}}{% endif %}
{% if url %}* [Amazon link]({{url}}){% endif %}
{% if appLink %}* [Kindle link]({{appLink}}){% endif %}
{% endtrim %}

## ハイライト
{{highlights}}
```

## Implementation Steps

1.  **Add Nunjucks Dependency:** Install the Nunjucks library and its TypeScript types.
    ```bash
    npm install nunjucks
    npm install --save-dev @types/nunjucks
    ```
2.  **Refactor `src/services/template-renderer.ts`:**
    *   Import the Nunjucks library.
    *   Modify the rendering function to use `nunjucks.renderString(templateContent, contextData)`.
    *   Implement error handling for rendering failures.
3.  **Update Default Template:**
    *   Locate the default template string (likely in `src/settings.ts` or `src/templates/default-template.ts`).
    *   Replace it with the new Nunjucks template provided above.
4.  **Adapt Data Context in `src/main.ts`:**
    *   Ensure the data object passed to the rendering function contains keys matching the template variables (`imageUrl`, `author`, `title`, `highlights`, etc.).
    *   Verify that the `highlights` variable is prepared as a final string before rendering.
5.  **Update Settings Description in `src/settings.ts`:**
    *   Modify the description for the template setting to mention Nunjucks syntax and potentially link to documentation.
6.  **Testing:**
    *   Add or update unit tests for `template-renderer.ts` to cover Nunjucks rendering scenarios, including handling optional data.

## Plan Visualization

```mermaid
graph TD
    A[Start: Adopt Nunjucks Template] --> B(Install Nunjucks);
    B --> C(Refactor `template-renderer.ts` to use Nunjucks);
    C --> D(Update Default Template String with Nunjucks format);
    D --> E(Verify/Adapt Data Context in `main.ts`);
    E --> F(Update Setting Description in `settings.ts`);
    F --> G(Add/Update Unit Tests for Nunjucks Rendering);
    G --> H[End: Nunjucks Template Integrated];
