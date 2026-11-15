# DracoLight

Um jogo de voo livre em uma cidade destrutível. Voe como um dragão oriental, atravesse prédios e suba até a estratosfera, sem inimigos ou barra de vida.

**[Jogar DracoLight](https://eddiericobom.github.io/DracoLight/)**

O jogo aceita teclado e mouse, controle com analógicos ou controles de toque em celulares. Os controles aparecem no menu inicial e, no celular, durante o voo.

Segure Shift ou o gatilho direito para impulsionar. Ao ultrapassar aproximadamente 343 m/s, o voo produz uma onda de choque e um estrondo. Para reconstruir a cidade, pause o jogo e selecione **Reconstruir cidade**.

Mergulhar aumenta continuamente a velocidade; frear ou interromper um mergulho muito rápido produz uma onda de impacto.

Escolha a tinta no menu inicial ou no menu de pausa (Esc). As cores escolhidas afetam os novos rastros, que desaparecem gradualmente após cerca de 15 segundos; use **Limpar tinta** para apagá-los antes. A tinta também colore as partes da cidade que toca; essa pintura permanece até ser limpa ou a cidade ser reconstruída.

Voe em círculos na mesma direção para formar um tornado de tinta. Continuar girando faz o tornado crescer e permanecer por mais tempo; a velocidade do voo influencia sua rotação.

Clique com o botão direito do mouse, pressione X no controle ou toque em **Tinta** para criar uma bola. Atravesse-a para lançar um meteoro com sua velocidade; ao alcançar o chão, ele destrói construções próximas.

## Executar localmente

Instale o Node.js, depois execute:

```sh
npm ci
npm run dev
```

Abra no navegador o endereço informado pelo Vite. Para gerar a versão de produção, use `npm run build`; os arquivos serão criados em `dist/`.

O GitHub Actions compila e publica automaticamente alterações em `main`. Nas configurações do repositório, o GitHub Pages deve estar configurado para usar **GitHub Actions** como fonte.


## Personagem e cooperação

No menu inicial ou de pausa, selecione **Jogar como personagem** para controlar o modelo fornecido. Use W/A/S/D ou o analógico esquerdo para se mover, Shift ou o gatilho direito para correr, e Espaço ou o botão de subir para pular. Corra contra um prédio para escalá-lo. O personagem não possui tinta.

Para jogar em cooperação, uma pessoa cria uma sala e compartilha o código de cinco caracteres; as demais podem digitar o código ou procurar a sala na lista. O anfitrião controla o dragão e até quatro convidados controlam o personagem. Quando o anfitrião reconstrói a cidade, ela também é reconstruída para todos os convidados, mesmo com o jogo pausado. A posição dos jogadores e as alterações recentes da cidade são sincronizadas durante a sessão. O lobby usa servidores públicos de sinalização, e os jogadores se conectam diretamente por WebRTC. Algumas redes restritas podem impedir a conexão, pois não há servidor TURN configurado.

Assets urbanos e texturas do Poly Haven são CC0; as fontes estão nos arquivos de créditos em `public/polyhaven` e `public/textures`.
