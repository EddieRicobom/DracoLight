# DracoLight

Um jogo de voo livre em uma cidade destrutível. Voe como Rayquaza, atravesse prédios e suba até a estratosfera, sem inimigos ou barra de vida.

**[Jogar DracoLight](https://eddiericobom.github.io/DracoLight/)**

O jogo usa teclado e mouse. Os controles aparecem no menu inicial.

## Executar localmente

Instale o Node.js, depois execute:

```sh
npm ci
npm run dev
```

Abra no navegador o endereço informado pelo Vite. Para gerar a versão de produção, use `npm run build`; os arquivos serão criados em `dist/`.

O GitHub Actions compila e publica automaticamente alterações em `main`. Nas configurações do repositório, o GitHub Pages deve estar configurado para usar **GitHub Actions** como fonte.

Modelos 3D obtidos de [Pokémon 3D API Assets](https://github.com/Pokemon-3D-api/assets). Pokémon e seus modelos pertencem aos respectivos titulares; o repositório de origem não concede direitos sobre eles.

A cidade é um mundo individual: multiplayer é uma possibilidade futura e ainda não está implementado. Assets urbanos e texturas do Poly Haven são CC0; as fontes estão nos arquivos de créditos em `public/polyhaven` e `public/textures`.
